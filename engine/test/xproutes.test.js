// XP over HTTP (server/xproutes.js): GET /api/xp/<wallet> and POST /api/genesis, on an
// in-memory Store, the server's sign-ins (social.js makeSessions) and a fake chain made of
// the Genesis fixtures (see genesis.test.js for where they come from).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { makeSessions } from "../server/social.js";
import { XpLedger } from "../server/xp.js";
import { makeXpRoutes } from "../server/xproutes.js";
import { POINTS } from "../src/xp.js";

const T = Date.UTC(2026, 9, 1, 12);
const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/genesis-${name}.json`, import.meta.url), "utf8"));
const MEMBER = fx("member-mint");
const HOLDER = fx("holder-account");
const wallet = () => Keypair.generate().publicKey;

/** A token account of the Genesis member mint, owned by `owner`, holding `amount`. */
function holding(owner, amount = 1n) {
  const data = Buffer.from(HOLDER.data, "base64");
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return { pubkey: wallet(), account: { owner: new PublicKey(HOLDER.owner), data } };
}

function rig({ held = new Map(), down = false } = {}) {
  const store = new Store(":memory:");
  const ledger = new XpLedger(store.db);
  const sessions = makeSessions(store.db, () => T);
  const heard = [];
  let reads = 0;
  const l1 = {
    getTokenAccountsByOwner: async (owner) => {
      reads++;
      if (down) throw new Error("rpc down");
      return { value: held.get(owner.toBase58()) ?? [] };
    },
    getMultipleAccountsInfo: async (keys) =>
      keys.map((k) => (k.toBase58() === MEMBER.pubkey ? { owner: new PublicKey(MEMBER.owner), data: Buffer.from(MEMBER.data, "base64") } : null)),
  };
  const routes = makeXpRoutes({ ledger, l1, walletOf: sessions.walletOf, onXp: (ws) => heard.push(...ws), now: () => T });
  const call = async (method, path, body = {}, ip = "1.1.1.1") => {
    const r = routes.find((x) => x.method === method && x.path.test(path));
    try {
      return { status: 200, json: (await r.handler({ params: path.match(r.path).groups ?? {}, body, ip })).json };
    } catch (e) {
      return { status: e.status, json: { error: e.message } };
    }
  };
  const token = (w) => sessions.issue(w.toBase58()).token;
  return { ledger, heard, call, token, reads: () => reads };
}

test("GET /api/xp/<wallet>: the wallet's row, zeros for a new one, 400 for a key that isn't a wallet", async () => {
  const r = rig();
  const a = wallet().toBase58();
  assert.deepEqual(await r.call("GET", `/api/xp/${a}`), { status: 200, json: r.ledger.row(a, T) });
  assert.equal((await r.call("GET", `/api/xp/${a}`)).json.total, 0);
  r.ledger.award(a, "kolLaunch", "p", T);
  assert.equal((await r.call("GET", `/api/xp/${a}`)).json.total, POINTS.kolLaunch.points);
  assert.deepEqual(await r.call("GET", `/api/xp/${"1".repeat(44)}`), { status: 400, json: { error: "wallet is not a Solana address" } });
});

test("POST /api/genesis: a holder gets the perk once; asking again reads nothing", async () => {
  const me = wallet();
  const r = rig({ held: new Map([[me.toBase58(), [holding(me)]]]) });
  assert.deepEqual(await r.call("POST", "/api/genesis", {}), { status: 401, json: { error: "sign in first" } });
  const first = await r.call("POST", "/api/genesis", { token: r.token(me) });
  assert.equal(first.status, 200);
  assert.deepEqual({ ...first.json, xp: undefined }, { wallet: me.toBase58(), genesis: { mint: MEMBER.pubkey, at: T }, fresh: true, xp: undefined });
  assert.equal(first.json.xp.total, POINTS.genesis.points);
  assert.deepEqual(first.json.xp.genesis, { mint: MEMBER.pubkey, at: T });
  assert.deepEqual(r.heard, [me.toBase58()], "the change is pushed");
  const again = await r.call("POST", "/api/genesis", { token: r.token(me) });
  assert.deepEqual([again.status, again.json.fresh, again.json.genesis], [200, false, { mint: MEMBER.pubkey, at: T }]);
  assert.equal(r.reads(), 1, "the stored claim answers");
  assert.deepEqual(r.heard, [me.toBase58()], "nothing new to push");
});

test("POST /api/genesis: another wallet with the same token is 409; none, a zero balance, or a chain that's down", async () => {
  const [me, other, none, zero] = [wallet(), wallet(), wallet(), wallet()];
  const held = new Map([[me.toBase58(), [holding(me)]], [other.toBase58(), [holding(other)]], [zero.toBase58(), [holding(zero, 0n)]]]);
  const r = rig({ held });
  assert.equal((await r.call("POST", "/api/genesis", { token: r.token(me) })).status, 200);
  const short = `${me.toBase58().slice(0, 4)}…${me.toBase58().slice(-4)}`;
  assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(other) }), { status: 409, json: { error: `this Seeker's Genesis Token was already used by ${short}` } });
  assert.equal(r.ledger.row(other.toBase58(), T).total, 0);
  for (const w of [none, zero]) {
    assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(w) }), { status: 404, json: { error: "no Seeker Genesis Token in this wallet" } });
  }
  const d = rig({ down: true });
  assert.deepEqual(await d.call("POST", "/api/genesis", { token: d.token(me) }), { status: 503, json: { error: "couldn't read this wallet's tokens, try again" } });
});

test("POST /api/genesis: 3 a minute per wallet, 10 per IP", async () => {
  const me = wallet();
  const r = rig({ held: new Map([[me.toBase58(), [holding(me)]]]) });
  for (let i = 0; i < 3; i++) assert.equal((await r.call("POST", "/api/genesis", { token: r.token(me) })).status, 200);
  assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(me) }), { status: 429, json: { error: "too many Genesis checks from this wallet, try again later" } });
  const ip = "2.2.2.2";
  for (let i = 0; i < 10; i++) await r.call("POST", "/api/genesis", { token: r.token(wallet()) }, ip);
  assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(wallet()) }, ip), { status: 429, json: { error: "too many Genesis checks, try again later" } });
});
