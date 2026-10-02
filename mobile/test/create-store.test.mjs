// The store's create actions (mintCoin, openCoin, openCost, forgetOpening) with fake flows:
// the steps the screen shows, the words a refusal comes back in, the open remembered as this
// wallet's, an open that may have gone out coming back unknown, never as a plain failure, and
// its coin saved for the wallet before the wallet is asked, again once it has signed and when
// an unknown is reported (on disk, and in memory when the disk refuses), until a retry, the
// presale or Start over settles it. A retry reads its presale first, signs only after the
// server's own 404, and keeps its commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../../engine/src/apiclient.js";
import { OUTCOME_UNKNOWN, outcomeUnknown } from "../../engine/src/tx.js";
import { ALREADY_OPEN, OPEN_PENDING, RETRY_UNCHECKED } from "../src/create/rules.js";
import { createMoonerStore } from "../src/store.js";

const W = "Wallet1111";
const OPENER = "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale.";
const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const COIN = {
  name: "Moon Dog",
  symbol: "MDOG",
  description: "",
  links: { twitter: "", telegram: "", website: "" },
  image: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
};
const PID = "6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa";
/** The coin and its presale: two keys made for these tests, no one's. A saved open needs real
 *  keys (create/rules.js isOpening). */
const MINT = "CtqGFBa6JYHvjp52W1oJ3r2ZoTYidPDbAmKbyU68oTWk";
const PRE = "FjwDw8HvJEXrkmwwzZkNfKW4C6hGgCpMVvDvuhwDxwu2";
/** Another wallet, a key made for these tests too. */
const OTHER = "Beqnsw1bfeTdHKvFrGXLcXLj6NV4WX6x8Sde3VsxAcGC";
/** The server's coin, with its presale's key, as the screen hands it to openCoin. */
const OPENING = {
  mint: MINT,
  presale: PRE,
  symbol: "MDOG",
  name: "Moon Dog",
  description: "",
  links: { twitter: "", telegram: "", website: "" },
  image: "https://gw/ipfs/img",
};
/** What the wrapper saves for the wallet before it asks: the coin, its commit, and `at`, the
 *  time of the save (the rig's clock, 5_000 unless a test moves it). */
const SAVED = { ...OPENING, commit: "100000000", at: 5_000 };
/** The same coin as an earlier try saved it. */
const OLD = { ...SAVED, at: 1_000 };
const SAVED_NAME = `mooner:opening:${W}`;
/** A retry's read as openCoin hands it back: its verdict, and when it was asked. */
const readOf = (verdict) => ({ verdict, at: 5_000 });
/** GET /api/presale for a presale the server doesn't know: its own 404 (api.js onePresale). */
const NOT_FOUND = async () => {
  throw new ApiError(404, "no such presale", { error: "no such presale" });
};
/** The server's simulation refusing a second presale for the mint: the program's own
 *  AlreadyExists (28), as api.js cosignChecked answers it. */
const ALREADY_EXISTS = new ApiError(400, "the tx fails: ix 1: AlreadyExists (28)", {
  error: "the tx fails: ix 1: AlreadyExists (28)",
  logs: [`Program ${PID} invoke [1]`, `Program ${PID} failed: custom program error: 0x1c`],
  sent: false,
});

/** `disk`: the phone's saved state (a fresh rig on the same disk is the app started again);
 *  `presale(key)`: what GET /api/presale gives; `setFails`, `clearFails`: secure storage
 *  refuses every save, every clear; `hold(name)`: a read of `name` waits for what it returns;
 *  `now`: the store's clock (5_000 unless a test moves it). */
function rig({
  flows: over = {},
  signer: signerOver = {},
  presale = NOT_FOUND,
  disk = new Map(),
  setFails = false,
  clearFails = false,
  hold = () => {},
  now = () => 5_000,
} = {}) {
  const live = { subscribe: () => () => {}, onStatus: () => () => {} };
  const saved = (name) => ({
    get: async () => {
      await hold(name);
      return disk.has(name) ? structuredClone(disk.get(name)) : undefined;
    },
    set: async (v) => {
      if (setFails) throw new Error("the secure store refused it");
      disk.set(name, structuredClone(v));
    },
    clear: async () => {
      if (clearFails) throw new Error("the secure store refused it");
      disk.delete(name);
    },
  });
  const calls = [];
  const flows = {
    loadInfo: async () => ({ N, pid: new PublicKey(PID) }),
    requestMint: async (a) => {
      calls.push(["mint", a]);
      await a.signMessage(new Uint8Array([1, 2, 3]));
      return { mint: MINT, presale: PRE, name: a.name, symbol: a.symbol, image: "https://gw/ipfs/img", uri: "https://gw/ipfs/meta" };
    },
    openPresale: async (a) => {
      calls.push(["open", a]);
      await a.signTransaction("TX");
      return { toBase58: () => PRE };
    },
    openCost: async () => ({ total: 8_800_000n }),
    ...over,
  };
  const signer = {
    publicKey: { toBase58: () => W },
    signTransaction: async (t) => (calls.push(["signTransaction", t]), t),
    signMessage: async (b) => (calls.push(["signMessage", b]), new Uint8Array(64)),
    ...signerOver,
  };
  const api = { presale: async (key) => (calls.push(["presale", key]), presale(key)) };
  const store = createMoonerStore({ live, api, flows, saved, market: {}, now });
  const steps = [];
  store.subscribe((s) => {
    const step = s.busy?.step;
    if (step && steps.at(-1) !== step) steps.push(step);
  });
  return { store, calls, disk, signer, steps };
}

test("mintCoin: the wallet signs the details, then the server's coin comes back", async () => {
  const { store, calls, signer, steps } = rig();
  const r = await store.getState().mintCoin(COIN, signer);
  assert.deepEqual(r, { ok: true, value: { mint: MINT, presale: PRE, name: "Moon Dog", symbol: "MDOG", image: "https://gw/ipfs/img", uri: "https://gw/ipfs/meta" } });
  const [, a] = calls.find(([k]) => k === "mint");
  assert.equal(a.wallet, signer.publicKey);
  assert.equal(a.name, "Moon Dog");
  assert.equal(a.image, COIN.image);
  assert.ok(calls.some(([k]) => k === "signMessage"));
  assert.deepEqual(steps, ["Sign the coin details in your wallet", "Saving the picture and details to IPFS"]);
  assert.equal(store.getState().busy, null);
});

test("mintCoin: a wallet that can't open presales is told so in plain words", async () => {
  const { store, signer } = rig({
    flows: { requestMint: async () => { throw new ApiError(403, "this wallet can't open presales yet (closed beta)", {}); } },
  });
  assert.deepEqual(await store.getState().mintCoin(COIN, signer), { ok: false, error: OPENER });
  assert.equal(store.getState().busy, null);
});

test("mintCoin: too many unopened coins points at them", async () => {
  const { store, signer } = rig({
    flows: { requestMint: async () => { throw new ApiError(429, "3 of your tokens aren't opened yet; open one of them first", { unopened: ["A", "B", "C"] }); } },
  });
  const r = await store.getState().mintCoin(COIN, signer);
  assert.equal(r.error, "3 of your coins aren't open yet. Open one of them first: they're at the top of Create.");
});

test("mintCoin: Decline in the wallet is a cancel, and nothing reaches the server", async () => {
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const { store, calls, signer } = rig({
    signer: { signMessage: async () => { throw declined; } },
    flows: {
      requestMint: async (a) => {
        await a.signMessage(new Uint8Array([1]));
        calls.push(["api.mint"]);
        return {};
      },
    },
  });
  assert.deepEqual(await store.getState().mintCoin(COIN, signer), { ok: false, error: "You cancelled it in your wallet." });
  assert.ok(!calls.some(([k]) => k === "api.mint"));
});

test("mintCoin: no new coin while one is saved for the wallet, and the wallet isn't asked; once it's cleared, it mints", async () => {
  const { store, calls, disk, signer, steps } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().mintCoin(COIN, signer), { ok: false, error: OPEN_PENDING });
  assert.ok(!calls.some(([k]) => k === "mint" || k === "signMessage"), "the wallet wasn't asked");
  assert.deepEqual(steps, []);
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
  assert.equal(store.getState().busy, null);
  await store.getState().forgetOpening(W, PRE);
  const r = await store.getState().mintCoin(COIN, signer);
  assert.equal(r.ok, true);
  assert.equal(r.value.mint, MINT);
  assert.ok(calls.some(([k]) => k === "signMessage"));
});

test("openCoin: the open with the creator's commit, then remembered as this wallet's seat", async () => {
  const { store, calls, disk, signer, steps } = rig();
  await store.getState().setWallet(W);
  const r = await store.getState().openCoin(OPENING, 100_000_000n, signer);
  assert.deepEqual(r, { ok: true, value: PRE });
  const [, a] = calls.find(([k]) => k === "open");
  assert.equal(a.mint, MINT);
  assert.equal(a.commit, 100_000_000n);
  assert.equal(a.wallet, signer.publicKey);
  assert.deepEqual(a.info.N, N);
  assert.deepEqual(calls.find(([k]) => k === "signTransaction"), ["signTransaction", "TX"]);
  assert.deepEqual(steps, ["Sign to open the presale with your SOL", "Opening the presale"]);
  assert.deepEqual(store.getState().mine[PRE], { deposit: "100000000", at: 5_000, back: null });
  assert.deepEqual(disk.get(`mooner:mine:${W}`)[PRE], { deposit: "100000000", at: 5_000, back: null });
  assert.ok(!calls.some(([k]) => k === "presale"), "no saved coin: no read first");
  assert.equal(store.getState().opening, null);
});

test("openCoin: a commit over the cap stops before the wallet is asked", async () => {
  const { store, calls, signer } = rig();
  const r = await store.getState().openCoin(OPENING, 500_000_000n, signer);
  assert.deepEqual(r, { ok: false, error: "Pick 0.1 to 0.4 SOL, so others have room to join." });
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
});

test("openCoin: the co-signer's refusals in plain words", async () => {
  const opener = rig({ flows: { openPresale: async () => { throw new ApiError(403, "wallet not on the openers list", {}); } } });
  assert.deepEqual(await opener.store.getState().openCoin(OPENING, 100_000_000n, opener.signer), { ok: false, error: OPENER });
  const other = rig({ flows: { openPresale: async () => { throw new ApiError(403, "the creator can put in at most 0.4 SOL, so others can join", {}); } } });
  assert.deepEqual(await other.store.getState().openCoin(OPENING, 100_000_000n, other.signer), {
    ok: false,
    error: "the creator can put in at most 0.4 SOL, so others can join",
  });
});

test("openCost: the flow's total", async () => {
  const { store } = rig();
  assert.equal(await store.getState().openCost(), 8_800_000n);
});

test("create waits for any other action, and frees the store after", async () => {
  let release;
  const { store, signer } = rig({
    flows: {
      requestMint: async () => {
        await new Promise((r) => (release = r));
        return { mint: MINT };
      },
    },
  });
  const first = store.getState().mintCoin(COIN, signer);
  assert.equal(store.getState().busy.kind, "create");
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: "Wait for the last one to finish." });
  release();
  assert.equal((await first).ok, true);
  assert.equal(store.getState().busy, null);
});

/** A rig whose open fails with `e` after the wallet signed it; `after()` runs between the
 *  signature and the failure, during the cosign; `more`: rig's other options. */
const signedThen = (e, { after = () => {}, ...more } = {}) =>
  rig({
    ...more,
    flows: {
      openPresale: async (a) => {
        await a.signTransaction("TX");
        after();
        throw e;
      },
    },
  });

/** signedThen's options for a clock that moves on: 5_000 when the wallet is asked, 7_000 once
 *  it has signed, 9_000 when the failure comes back. */
function movingClock() {
  let t = 5_000;
  return {
    now: () => t,
    signer: { signTransaction: async (tx) => ((t = 7_000), tx) },
    after: () => void (t = 9_000),
  };
}
/** The coin as saved once the wallet signed, and as saved when the unknown was reported. */
const SIGNED = { ...SAVED, at: 7_000 };
const REPORTED = { ...SAVED, at: 9_000 };

/** openCoin on signedThen(e): what it gave back, the wallet's seats (the state's and the
 *  saved ones) and the steps shown. */
async function openAfterSigning(e) {
  const { store, disk, signer, steps } = signedThen(e);
  await store.getState().setWallet(W);
  const r = await store.getState().openCoin(OPENING, 100_000_000n, signer);
  return { r, mine: store.getState().mine, saved: disk.get(`mooner:mine:${W}`), steps };
}

test("openCoin: the co-signer's unknown outcome after the wallet signed stays unknown, and no seat is remembered", async () => {
  const { r, mine, saved, steps } = await openAfterSigning(outcomeUnknown("SIG", "cosign"));
  assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN });
  assert.deepEqual(steps, ["Sign to open the presale with your SOL", "Opening the presale"]);
  assert.equal(mine[PRE], undefined);
  assert.equal(saved?.[PRE], undefined);
});

test("openCoin: the presale not seen in time after the server's 202 is an unknown outcome", async () => {
  // flows.js since 6b9bbfe (waitSent), and the words before it
  for (const e of [outcomeUnknown("SIG", "open"), new Error("the presale didn't show up yet; refresh in a moment")]) {
    const { r, mine } = await openAfterSigning(e);
    assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN }, e.message);
    assert.equal(mine[PRE], undefined, e.message);
  }
});

test("openCoin: a network error or a 5xx after the wallet signed is an unknown outcome", async () => {
  for (const e of [new TypeError("Network request failed"), new ApiError(502, "bad gateway", {})]) {
    const { r, saved } = await openAfterSigning(e);
    assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN }, e.message);
    assert.equal(saved?.[PRE], undefined, e.message);
  }
});

test("openCoin: the API client's deadline after the wallet signed is an unknown outcome", async () => {
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s"), { timedOut: true });
  const { r } = await openAfterSigning(late);
  assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN });
});

test("openCoin: the server's refusal after signing sent nothing: its own words, and a retry of an open that landed says so", async () => {
  const rent = await openAfterSigning(
    new ApiError(400, "the tx fails: Transaction results in an account (0) with insufficient funds for rent", { logs: [] }),
  );
  assert.deepEqual(rent.r, { ok: false, error: "Your wallet needs a little more SOL to cover rent and the Solana fee." });
  const again = await openAfterSigning(ALREADY_EXISTS);
  assert.deepEqual(again.r, { ok: false, error: ALREADY_OPEN });
  assert.equal(again.mine[PRE], undefined, "the screen goes to the room, whose seats show it");
});

test("openCoin: a failure before the wallet signed is a plain failure", async () => {
  const net = rig({ flows: { openPresale: async () => { throw new TypeError("Network request failed"); } } });
  assert.deepEqual(await net.store.getState().openCoin(OPENING, 100_000_000n, net.signer), { ok: false, error: "Network request failed" });
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const no = rig({ signer: { signTransaction: async () => { throw declined; } } });
  assert.deepEqual(await no.store.getState().openCoin(OPENING, 100_000_000n, no.signer), { ok: false, error: "You cancelled it in your wallet." });
});

test("openCoin: an unknown outcome keeps the coin saved for its wallet, as of when that was reported; the app started again reads it back, for that wallet only", async () => {
  const first = signedThen(outcomeUnknown("SIG", "cosign"), movingClock());
  await first.store.getState().setWallet(W);
  assert.equal(first.store.getState().opening, null, "none saved yet");
  assert.deepEqual(await first.store.getState().openCoin(OPENING, 100_000_000n, first.signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.deepEqual(first.store.getState().opening, REPORTED, "the report's time, not the prompt's or the sign's");
  assert.deepEqual(first.disk.get(SAVED_NAME), REPORTED);
  const again = rig({ disk: first.disk });
  assert.equal(again.store.getState().opening, undefined, "not read before a wallet connects");
  await again.store.getState().setWallet("Other1111");
  assert.equal(again.store.getState().opening, null, "another wallet has none");
  await again.store.getState().setWallet(W);
  assert.deepEqual(again.store.getState().opening, REPORTED);
});

test("openCoin: a retry of the saved coin reads its presale once first; a success and the program's AlreadyExists clear it", async () => {
  const ok = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await ok.store.getState().setWallet(W);
  assert.deepEqual(await ok.store.getState().openCoin(OPENING, 100_000_000n, ok.signer), { ok: true, value: PRE, read: readOf("retry") });
  assert.deepEqual(ok.calls.filter(([k]) => k === "presale"), [["presale", PRE]]);
  assert.equal(ok.store.getState().opening, null);
  assert.equal(ok.disk.has(SAVED_NAME), false);
  const taken = signedThen(ALREADY_EXISTS, { disk: new Map([[SAVED_NAME, OLD]]) });
  await taken.store.getState().setWallet(W);
  assert.deepEqual(await taken.store.getState().openCoin(OPENING, 100_000_000n, taken.signer), {
    ok: false,
    error: ALREADY_OPEN,
    read: readOf("retry"),
  });
  assert.equal(taken.store.getState().opening, null);
  assert.equal(taken.disk.has(SAVED_NAME), false);
});

test("openCoin: a retry whose presale the server knows, closed too, was already opened: nothing is signed and the saved coin clears", async () => {
  const closed = { presale: PRE, where: "closed", state: "CLOSED", token: { mint: MINT }, launch: null, seats: [] };
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]), presale: async () => closed });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: ALREADY_OPEN, read: readOf("open") });
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.equal(store.getState().opening, null);
  assert.equal(disk.has(SAVED_NAME), false);
});

test("openCoin: a retry whose presale can't be read signs nothing, and the saved coin stays", async () => {
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s"), { timedOut: true });
  const { store, calls, disk, signer } = rig({
    disk: new Map([[SAVED_NAME, OLD]]),
    presale: async () => {
      throw late;
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: RETRY_UNCHECKED, read: readOf("unknown") });
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.deepEqual(store.getState().opening, OLD);
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
});

test("openCoin: the coin is saved, with when, before the wallet is asked; nothing is saved when no prompt comes", async () => {
  const disk = new Map();
  const seen = {};
  const { store, signer } = rig({
    disk,
    signer: { signTransaction: async (t) => ((seen.prompt = structuredClone(disk.get(SAVED_NAME))), t) },
    flows: {
      openPresale: async (a) => {
        await a.signTransaction("TX");
        seen.open = structuredClone(disk.get(SAVED_NAME));
        return { toBase58: () => PRE };
      },
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: true, value: PRE });
  assert.deepEqual(seen.prompt, SAVED, "on disk, with `at`, when the wallet is asked");
  assert.deepEqual(seen.open, SAVED, "and while the open goes out");
  assert.equal(disk.has(SAVED_NAME), false, "a success clears it");
  assert.equal(store.getState().opening, null);
  const writes = [];
  const quiet = new Map();
  const put = quiet.set.bind(quiet);
  quiet.set = (k, v) => (writes.push(k), put(k, v));
  const net = rig({ disk: quiet, flows: { openPresale: async () => { throw new TypeError("Network request failed"); } } });
  await net.store.getState().setWallet(W);
  assert.deepEqual(await net.store.getState().openCoin(OPENING, 100_000_000n, net.signer), { ok: false, error: "Network request failed" });
  assert.ok(!writes.includes(SAVED_NAME), "no prompt came, so nothing was written");
  assert.equal(net.store.getState().opening, null);
});

test("openCoin: a first try the wallet refuses leaves no saved coin", async () => {
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const { store, disk, signer } = rig({ signer: { signTransaction: async () => { throw declined; } } });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: "You cancelled it in your wallet." });
  assert.equal(disk.has(SAVED_NAME), false);
  assert.equal(store.getState().opening, null);
});

test("openCoin: a retry the wallet refuses, or the server refuses after the sign, keeps the saved coin as it was; a signed retry's unknown outcome keeps it, as of when that was reported", async () => {
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const no = rig({ disk: new Map([[SAVED_NAME, OLD]]), signer: { signTransaction: async () => { throw declined; } } });
  await no.store.getState().setWallet(W);
  assert.deepEqual(await no.store.getState().openCoin(OPENING, 100_000_000n, no.signer), {
    ok: false,
    error: "You cancelled it in your wallet.",
    read: readOf("retry"),
  });
  assert.deepEqual(no.disk.get(SAVED_NAME), OLD, "as the earlier try left it: this one was never signed");
  assert.deepEqual(no.store.getState().opening, OLD);
  const rent = new ApiError(400, "the tx fails: Transaction results in an account (0) with insufficient funds for rent", { logs: [] });
  const refused = signedThen(rent, { disk: new Map([[SAVED_NAME, OLD]]), ...movingClock() });
  await refused.store.getState().setWallet(W);
  assert.deepEqual(await refused.store.getState().openCoin(OPENING, 100_000_000n, refused.signer), {
    ok: false,
    error: "Your wallet needs a little more SOL to cover rent and the Solana fee.",
    read: readOf("retry"),
  });
  assert.deepEqual(refused.disk.get(SAVED_NAME), OLD, "signed, but the server never sent it: as the earlier try left it");
  assert.deepEqual(refused.store.getState().opening, OLD);
  const lost = signedThen(outcomeUnknown("SIG", "cosign"), { disk: new Map([[SAVED_NAME, OLD]]), ...movingClock() });
  await lost.store.getState().setWallet(W);
  assert.deepEqual(await lost.store.getState().openCoin(OPENING, 100_000_000n, lost.signer), {
    ok: false,
    error: OUTCOME_UNKNOWN,
    read: readOf("retry"),
  });
  assert.deepEqual(lost.disk.get(SAVED_NAME), REPORTED);
  assert.deepEqual(lost.store.getState().opening, REPORTED);
});

test("openCoin: the coin is saved again once the wallet signs, so an app that ends during the cosign comes back with the time it was signed", async () => {
  const disk = new Map();
  const clock = movingClock();
  let cosign; // the disk during the cosign, where the app ends
  const { store, signer } = signedThen(outcomeUnknown("SIG", "cosign"), {
    disk,
    ...clock,
    after: () => {
      cosign = structuredClone(disk);
      clock.after();
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: OUTCOME_UNKNOWN });
  // checked here, not in the stub: an assertion thrown there, after the sign, would come back as
  // OUTCOME_UNKNOWN like the stub's own failure, and the test would pass anyway
  assert.deepEqual(cosign.get(SAVED_NAME), SIGNED, "the sign's time, not the prompt's");
  const again = rig({ disk: cosign });
  await again.store.getState().setWallet(W);
  assert.deepEqual(again.store.getState().opening, SIGNED);
});

test("openCoin: each save of the coin is in the state before it reaches the disk", async () => {
  let store;
  const seen = []; // the state's `opening` as each save of the coin reaches the disk
  const disk = new Map();
  const put = disk.set.bind(disk);
  disk.set = (k, v) => (k === SAVED_NAME && seen.push(store.getState().opening), put(k, v));
  const r = signedThen(outcomeUnknown("SIG", "cosign"), { disk, ...movingClock() });
  store = r.store;
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, r.signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.deepEqual(seen, [SAVED, SIGNED, REPORTED]);
});

test("openCoin: a save for a wallet no longer connected stays out of the state, and is that wallet's when it connects again", async () => {
  let store;
  const r = signedThen(outcomeUnknown("SIG", "cosign"), {
    // another account is connected while the wallet is up
    signer: { signTransaction: async (tx) => (await store.getState().setWallet(OTHER), tx) },
  });
  store = r.store;
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, r.signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.equal(store.getState().wallet, OTHER);
  assert.equal(store.getState().opening, null, "the connected wallet has none");
  assert.deepEqual(r.disk.get(SAVED_NAME), SAVED);
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, SAVED);
});

test("openCoin: when secure storage refuses the save, a copy in memory keeps the coin for its wallet while the app runs", async () => {
  const { store, disk, signer } = signedThen(outcomeUnknown("SIG", "cosign"), { setFails: true });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.equal(disk.has(SAVED_NAME), false, "the save didn't reach the disk");
  await store.getState().setWallet(null);
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, SAVED);
  await store.getState().setWallet("Other1111");
  assert.equal(store.getState().opening, null, "another wallet has none");
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, SAVED);
  await store.getState().forgetOpening(W, PRE);
  assert.equal(store.getState().opening, null);
  await store.getState().setWallet(null);
  await store.getState().setWallet(W);
  assert.equal(store.getState().opening, null, "a clear removes the copy too");
});

test("openCoin: when secure storage refuses the save over an earlier try's coin, the copy in memory wins over the disk", async () => {
  const { store, disk, signer } = signedThen(outcomeUnknown("SIG", "cosign"), {
    disk: new Map([[SAVED_NAME, OLD]]),
    setFails: true,
    ...movingClock(),
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: OUTCOME_UNKNOWN, read: readOf("retry") });
  assert.deepEqual(disk.get(SAVED_NAME), OLD, "the disk still has the earlier try's");
  await store.getState().setWallet(null);
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, REPORTED, "this try's last save, not the disk's older `at`");
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const no = { ...signer, signTransaction: async () => { throw declined; } };
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, no), {
    ok: false,
    error: "You cancelled it in your wallet.",
    read: { verdict: "retry", at: 9_000 },
  });
  assert.deepEqual(store.getState().opening, REPORTED, "a refused retry puts back the copy in memory, not the disk's");
});

test("openCoin: when secure storage refuses the clear, the copy in memory keeps it cleared while the app runs", async () => {
  const { store, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]), clearFails: true });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: true, value: PRE, read: readOf("retry") });
  assert.deepEqual(disk.get(SAVED_NAME), SAVED, "the clear didn't reach the disk");
  await store.getState().setWallet(null);
  await store.getState().setWallet(W);
  assert.equal(store.getState().opening, null, "the disk's coin doesn't come back");
});

test("setWallet: another wallet's `opening` is unread (undefined) until it has been read", async () => {
  const { store } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, OLD);
  const switching = store.getState().setWallet(OTHER);
  assert.equal(store.getState().opening, undefined, "not the last wallet's coin");
  await switching;
  assert.equal(store.getState().opening, null);
});

test("setWallet: a reconnect while an open goes out shows the coin's last save, not the one there when it began", async () => {
  let store;
  let reconnect;
  let release;
  let held; // the reconnect's sign-in read, held until the open is done
  const clock = movingClock();
  const r = signedThen(outcomeUnknown("SIG", "cosign"), {
    ...clock,
    hold: (name) => (name === `mooner:login:${W}` ? held : undefined),
    signer: {
      // the adapter drops the account and brings it back while the wallet is up
      signTransaction: async (tx) => {
        await store.getState().setWallet(null);
        held = new Promise((done) => (release = done));
        reconnect = store.getState().setWallet(W);
        return clock.signer.signTransaction(tx);
      },
    },
  });
  store = r.store;
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, r.signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.deepEqual(store.getState().opening, REPORTED);
  release();
  await reconnect;
  assert.deepEqual(r.disk.get(SAVED_NAME), REPORTED);
  assert.deepEqual(store.getState().opening, REPORTED, "the report's, as on disk");
});

test("openCoin: a presale the feed already shows stops the open before the wallet is asked", async () => {
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  store.setState({ presales: { [PRE]: { presale: PRE, state: "OPEN" } } });
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: ALREADY_OPEN, read: readOf("retry") });
  assert.ok(calls.some(([k]) => k === "open"), "the open was built");
  assert.ok(!calls.some(([k]) => k === "signTransaction"), "the wallet wasn't asked");
  assert.equal(store.getState().opening, null);
  assert.equal(disk.has(SAVED_NAME), false);
});

test("openCoin: no other coin opens while one is saved, and forgetOpening clears only the coin it names", async () => {
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  await store.getState().forgetOpening(W, "Pre2");
  assert.deepEqual(store.getState().opening, OLD, "another presale's key clears nothing");
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
  const other = { ...OPENING, mint: "Mint2", presale: "Pre2", symbol: "MCAT" };
  assert.deepEqual(await store.getState().openCoin(other, 100_000_000n, signer), { ok: false, error: OPEN_PENDING });
  assert.ok(!calls.some(([k]) => k === "presale" || k === "open" || k === "signTransaction"));
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
  await store.getState().forgetOpening(W, PRE);
  assert.equal(store.getState().opening, null);
  assert.equal(disk.has(SAVED_NAME), false);
});

test("openCoin: a 404 without the server's own words signs nothing, and the saved coin stays", async () => {
  // http.js's 404 for a path no route has, and a proxy's with no JSON (apiclient.js: body null)
  for (const e of [new ApiError(404, "not found", { error: "not found" }), new ApiError(404, "the server said 404", null)]) {
    const { store, calls, disk, signer } = rig({
      disk: new Map([[SAVED_NAME, OLD]]),
      presale: async () => {
        throw e;
      },
    });
    await store.getState().setWallet(W);
    assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: RETRY_UNCHECKED, read: readOf("unknown") }, e.message);
    assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"), e.message);
    assert.deepEqual(disk.get(SAVED_NAME), OLD, e.message);
    assert.deepEqual(store.getState().opening, OLD, e.message);
  }
});

test("openCoin: a retry reads first, then checks its saved commit, which it keeps whatever the screen hands in", async () => {
  const BIG = { ...OLD, commit: "450000000" };
  const closed = { presale: PRE, where: "closed", state: "CLOSED", token: { mint: MINT }, launch: null, seats: [] };
  const landed = rig({ disk: new Map([[SAVED_NAME, BIG]]), presale: async () => closed });
  await landed.store.getState().setWallet(W);
  assert.deepEqual(await landed.store.getState().openCoin(OPENING, 100_000_000n, landed.signer), { ok: false, error: ALREADY_OPEN, read: readOf("open") });
  assert.equal(landed.disk.has(SAVED_NAME), false, "the read came before the commit check");
  const over = rig({ disk: new Map([[SAVED_NAME, BIG]]) });
  await over.store.getState().setWallet(W);
  assert.deepEqual(await over.store.getState().openCoin(OPENING, 100_000_000n, over.signer), {
    ok: false,
    error: "0.45 SOL is more than a seat can hold now.",
    read: readOf("retry"),
  });
  assert.ok(!over.calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.deepEqual(over.disk.get(SAVED_NAME), BIG);
  const kept = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await kept.store.getState().setWallet(W);
  assert.equal((await kept.store.getState().openCoin(OPENING, 250_000_000n, kept.signer)).ok, true);
  assert.equal(kept.calls.find(([k]) => k === "open")[1].commit, 100_000_000n, "the saved commit, not the screen's");
  assert.deepEqual(kept.store.getState().mine[PRE], { deposit: "100000000", at: 5_000, back: null });
});

test("openCoin: a retry's read is timed from when it was asked, not when it answered", async () => {
  let t = 5_000;
  const { store, signer } = rig({
    disk: new Map([[SAVED_NAME, OLD]]),
    now: () => t,
    presale: async (key) => {
      t = 6_000;
      return NOT_FOUND(key);
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: true, value: PRE, read: readOf("retry") });
});

test("openCoin: a retry short of SOL says so after the read, signs nothing, and the saved coin stays", async () => {
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  store.setState({ lamports: 50_000_000 });
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), {
    ok: false,
    error: "You need 0.109 SOL to open this (your commit plus about 0.0088 SOL in fees and rent). You have 0.05.",
    read: readOf("retry"),
  });
  assert.deepEqual(calls.filter(([k]) => k === "presale"), [["presale", PRE]]);
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
});

test("openCoin: a retry's funds check reads the signing wallet's SOL only, not another connected wallet's", async () => {
  const { store, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(OTHER);
  store.setState({ lamports: 50_000_000 });
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: true, value: PRE, read: readOf("retry") });
});
