// The HTTP API (spec "Off-chain"). Three jobs: hand out mint keys (the CA is known before
// the presale exists), co-sign entry txs, and show presales as users see them. Ledger txs
// (set_commit, rotate, leave) go from the client straight to the ER; the server isn't in
// that path.
//
//   GET  /api/info                   program, keys, ER endpoints, the presale numbers
//   POST /api/mint                   { wallet, name, symbol, description, links, image, time, signature }
//   POST /api/cosign                 { tx }  (base64, signed by the user) -> sent, { sig, confirmed }
//   GET  /api/presales               every live presale (open ones list the wallets in them)
//   GET  /api/launched               every launched token with its pool's price and progress
//   GET  /api/presale/:presale       one presale with its seats (or its record once closed)
//   GET  /api/token/:mint            a token the server issued
//   GET  /api/wallet/:wallet/tokens  the tokens a wallet asked for
//   GET  /api/wallet/:wallet/balance its SOL, in lamports
//   GET  /api/health                 keeper status, bot balance, what the live feed heard
//   GET  /api/blockhash              a recent Solana blockhash, for the txs a wallet signs
//   GET  /api/ws                     WebSocket: all of the above as it changes (hub.js, feed.js)

import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { DELEGATION_PROGRAM, describeTxError, numbers } from "../src/consts.js";
import { F_CLAIMED, PRESALE_LEN, PRESALE_VERSION, SEAT_LEN, STATE_NAME, decodePresale, decodeSeat } from "../src/layout.js";
import { configPda, poolAddresses, presalePda } from "../src/pdas.js";
import { decodePoolState } from "../src/dbc.js";
import { TxError, sendSigned, sigOf, within } from "../src/tx.js";
import { cosign, Refused } from "../src/cosigner.js";
import { launchTxSize } from "../src/bot.js";
import { mintMessage, verifySignature } from "./auth.js";
import { HttpError, Limiter, limit } from "./http.js";

const KEY = "(?<key>[1-9A-HJ-NP-Za-km-z]{32,44})";
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_UNOPENED = 3;
const TIME_SKEW_S = 300;
const PACKET = 1232;
const LINKS = ["twitter", "telegram", "website"];

export const DEFAULT_LIMITS = {
  mintPerIp: [20, 3_600_000],
  mintPerWallet: [5, 3_600_000],
  cosignPerIp: [30, 60_000],
  cosignPerWallet: [10, 60_000],
  balancePerIp: [120, 60_000],
};

/** The image type from its first bytes; the name a client gives it doesn't count. */
export function sniffImage(b) {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** `e` as an answer that says the tx never went out (`sent: false`). An error that isn't
 *  an answer already is a 500, its cause kept for the log (http.js). */
/** A simulation error's name: the RPC's JSON has a unit variant ("AlreadyProcessed") as the
 *  string, and one with data as an object keyed by the name. */
const errName = (err) => (typeof err === "string" ? err : err && typeof err === "object" ? Object.keys(err)[0] ?? null : null);

function unsent(e) {
  if (e instanceof HttpError) return Object.assign(e, { extra: { ...e.extra, sent: false } });
  if (e instanceof Refused) return new HttpError(403, e.message, { sent: false });
  return Object.assign(new HttpError(500, "internal error", { sent: false }), { cause: e });
}

const bad = (msg) => {
  throw new HttpError(400, msg);
};

export function parseKey(v, what) {
  try {
    if (typeof v !== "string") throw 0;
    return new PublicKey(v);
  } catch {
    return bad(`${what} is not a Solana address`);
  }
}

function text(v, what, { min, maxBytes, lines = false }) {
  if (typeof v !== "string") bad(`${what} must be text`);
  const s = v.trim();
  if (Buffer.byteLength(s, "utf8") < min) bad(`${what} is empty`);
  if (Buffer.byteLength(s, "utf8") > maxBytes) bad(`${what} is over ${maxBytes} bytes`);
  if ((lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(s)) bad(`${what} has control characters`);
  return s;
}

function parseLinks(v) {
  if (v == null) v = {};
  if (typeof v !== "object" || Array.isArray(v)) bad("links must be an object");
  const extra = Object.keys(v).filter((k) => !LINKS.includes(k));
  if (extra.length) bad(`unknown link ${extra[0]}`);
  const out = {};
  for (const k of LINKS) {
    const s = v[k] == null ? "" : text(v[k], k, { min: 0, maxBytes: 120 });
    if (s) {
      let u;
      try {
        u = new URL(s);
      } catch {
        bad(`${k} is not a link`);
      }
      if (u.protocol !== "https:") bad(`${k} must start with https://`);
    }
    out[k] = s;
  }
  return out;
}

export async function accountsOf(conn, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await conn.getMultipleAccountsInfo(keys.slice(i, i + 100))));
  return out;
}

/** The wallets committed to an open presale, biggest first: the faces on its card. */
export const facesOf = (seats) =>
  seats
    .filter((s) => s.commit > 0n)
    .sort((a, b) => (b.commit > a.commit) - (b.commit < a.commit))
    .map((s) => ({ user: s.user, commit: s.commit, creator: s.creator }));

/** A presale as the list shows it: no seats, but the faces while it's open. */
export function listItem(v) {
  const { seats, ...rest } = v;
  return rest.state === "OPEN" && seats ? { ...rest, users: facesOf(seats) } : rest;
}

/**
 * Presales, launched tokens and balances as users see them, read from Solana and the ERs.
 * Shared by the HTTP routes and the live feed (feed.js), so both hit the same cache.
 */
export function makeReads({ pid, l1, bot, store, dbcConfig, damm = () => null, now = Date.now }) {
  /** A delegated account is our presale only if it sits at our PDA for its mint. */
  function delegatedPresale(key, a) {
    if (a.data.length !== PRESALE_LEN || a.data[0] !== PRESALE_VERSION) return null;
    const p = decodePresale(a.data);
    return presalePda(pid, p.mint).equals(key) ? p : null;
  }

  /** Presales as users see them: the ER copy while delegated. Returns [{ key, where, p }]. */
  async function readPresales(keys) {
    const accs = await accountsOf(l1, keys);
    const out = [];
    const byEr = new Map();
    keys.forEach((key, i) => {
      const a = accs[i];
      if (!a) return;
      if (a.owner.equals(pid) && a.data.length === PRESALE_LEN) return out.push({ key, where: "home", p: decodePresale(a.data) });
      if (!a.owner.equals(DELEGATION_PROGRAM)) return;
      const p = delegatedPresale(key, a);
      if (!p) return;
      const v = p.validator.toBase58();
      if (!byEr.has(v)) byEr.set(v, []);
      byEr.get(v).push({ key, p });
    });
    for (const [v, list] of byEr) {
      const er = bot.ers[v];
      const live = er ? await accountsOf(er, list.map((x) => x.key)).catch(() => []) : [];
      list.forEach(({ key, p }, i) => {
        const e = live[i];
        // no ER copy (no endpoint, or it didn't answer): the snapshot from before delegation
        out.push(e?.data.length === PRESALE_LEN ? { key, where: "er", p: decodePresale(e.data) } : { key, where: "er", p, stale: true });
      });
    }
    return out;
  }

  const view = ({ key, where, p, stale }) => ({
    presale: key,
    where,
    ...(stale && { stale: true }),
    ...p,
    state: STATE_NAME[p.state],
    token: store.token(p.mint) ?? null,
    launch: store.launch(key),
  });

  async function seatsOf(presale, p) {
    // The delegated listing and its ER read go first, as in bot.js seatsLeft, so a seat that
    // moves home while they run is still found by the home listing. One in both shows home:
    // homeSeats re-reads each seat's owner on Solana, and that read is the last one. (A seat
    // can go back: its user may delegate it again while the presale is OPEN, entry.rs.)
    const er = bot.ers[p.validator.toBase58()];
    const away = er ? await bot.listDelegatedSeats(presale) : [];
    const accs = away.length ? await accountsOf(er, away) : [];
    const seats = new Map();
    for (const s of await bot.homeSeats(presale)) seats.set(s.key.toBase58(), { ...s, where: "home" });
    away.forEach((key, i) => {
      const a = accs[i];
      if (!seats.has(key.toBase58()) && a?.owner.equals(pid) && a.data.length === SEAT_LEN) seats.set(key.toBase58(), { key, ...decodeSeat(a.data), where: "er" });
    });
    return [...seats.values()].map(({ key, user, deposit, commit, settled, creator, flags, where }) => ({
      seat: key, user, deposit, commit, settled, claimed: (flags & F_CLAIMED) !== 0, creator, where,
    }));
  }

  // Reads are shared for a moment: every viewer of a presale polls it, and the RPC (the
  // keeper's too) rate-limits getProgramAccounts. Callers that arrive together share one
  // fetch; a failed fetch isn't kept.
  const cache = new Map();
  function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.promise;
    const promise = fn();
    cache.set(key, { at: now(), promise });
    promise.catch(() => cache.get(key)?.promise === promise && cache.delete(key));
    if (cache.size > 1_000) for (const [k, v] of cache) if (now() - v.at > 60_000) cache.delete(k);
    return promise;
  }

  // an open presale lists the wallets in it (the faces on its card); the seats are two
  // getProgramAccounts each, so they're kept a little longer than the list
  async function withUsers(v, p) {
    if (v.state !== "OPEN") return v;
    const seats = await cached(`faces:${v.presale.toBase58()}`, 10_000, () => seatsOf(v.presale, p)).catch(() => null);
    return seats ? { ...v, users: facesOf(seats) } : v;
  }

  const listPresales = () => cached("list", 3_000, async () => Promise.all((await readPresales(await bot.scan())).map((r) => withUsers(view(r), r.p))));

  /** Launched tokens with their pools, newest first. A pool that can't be read is null. Once a
   *  coin migrated and the feed found its DAMM v2 pool (`damm(mint)`: { pool, sqrtPrice }),
   *  the price is that pool's and `damm` its address. */
  const listLaunched = () =>
    cached("launched", 5_000, async () => {
      const rows = store.launches();
      const pools = rows.map((r) => poolAddresses(dbcConfig, new PublicKey(r.mint)).pool);
      const accs = await accountsOf(l1, pools);
      return rows.map((r, i) => {
        const s = decodePoolState(accs[i]?.data);
        const d = s?.migrated ? damm(r.mint) : null;
        return { ...r, pool: s && { address: pools[i], quoteReserve: s.quoteReserve, sqrtPrice: d?.sqrtPrice ?? s.sqrtPrice, migrated: s.migrated, damm: d?.pool ?? null } };
      });
    });

  async function onePresale(key) {
    const [r] = await readPresales([key]);
    if (r) return { ...view(r), seats: await seatsOf(key, r.p) };
    const token = store.tokenOfPresale(key);
    if (!token) throw new HttpError(404, "no such presale");
    return { presale: key, where: "closed", state: "CLOSED", token, launch: store.launch(key), seats: [] };
  }

  return {
    listPresales,
    listLaunched,
    /** One presale with its seats, or its record once closed; 404 if there's neither. */
    presale: (key) => cached(`presale:${key.toBase58()}`, 2_000, () => onePresale(key)),
    balance: (wallet) => cached(`balance:${wallet.toBase58()}`, 5_000, () => l1.getBalance(wallet, "confirmed")),
    blockhash: () => cached("blockhash", 2_000, () => l1.getLatestBlockhash("confirmed")),
    /** Something changed on chain: the next read of this presale (and the list) is fresh. */
    forget(presale) {
      const k = presale.toBase58();
      for (const c of [`presale:${k}`, `faces:${k}`, "list"]) cache.delete(c);
    },
    forgetLaunched: () => cache.delete("launched"),
    forgetBalance: (wallet) => cache.delete(`balance:${wallet.toBase58()}`),
  };
}

/**
 * Builds the routes. `bot` is the keeper's Bot: its validators, ER connections, bot key
 * and seat listings. `openers()` returns the current Set of wallets that may open (null:
 * any wallet).
 * `feed` (feed.js) hears about each entry the server sends, before the chain says so.
 */
export function makeRoutes({ pid, l1, bot, gateKey, alt, dbcConfig, store, pinner, openers, cluster, canary, keeper = null, feed = null, limits = DEFAULT_LIMITS, sendTimeoutMs = 45_000, simMs = 15_000, now = Date.now, reads = makeReads({ pid, l1, bot, store, dbcConfig, now }) }) {
  const N = numbers(canary);
  const L = Object.fromEntries(Object.entries({ ...DEFAULT_LIMITS, ...limits }).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));
  const usedSigs = new Map(); // signature -> when, for the replay window
  let botBalance = { at: 0, value: null };

  // ---- writes ----

  async function mint({ body, ip }) {
    limit(L.mintPerIp, ip, "token requests");
    const wallet = parseKey(body.wallet, "wallet");
    const allowed = openers();
    if (allowed && !allowed.has(wallet.toBase58())) throw new HttpError(403, "this wallet can't open presales yet (closed beta)");
    const name = text(body.name, "name", { min: 1, maxBytes: 32 });
    if (typeof body.symbol !== "string" || !/^[A-Za-z0-9]{1,10}$/.test(body.symbol)) bad("symbol must be 1 to 10 letters or digits");
    const symbol = body.symbol;
    const description = text(body.description ?? "", "description", { min: 0, maxBytes: 600, lines: true });
    const links = parseLinks(body.links);
    if (typeof body.image !== "string" || body.image.length > Math.ceil(MAX_IMAGE / 3) * 4) bad("image must be base64, at most 2 MB");
    const image = Buffer.from(body.image, "base64");
    const imageType = sniffImage(image);
    if (!imageType) bad("image must be a PNG, JPEG, GIF or WebP");
    const time = body.time;
    if (!Number.isInteger(time) || Math.abs(now() / 1000 - time) > TIME_SKEW_S) bad("time must be now, in unix seconds");
    const signature = typeof body.signature === "string" ? Buffer.from(body.signature, "base64") : Buffer.alloc(0);
    const details = [description, links.twitter, links.telegram, links.website];
    if (!verifySignature(wallet, mintMessage({ wallet, name, symbol, image, details, time }), signature)) {
      throw new HttpError(401, "the signature doesn't match this wallet and these details");
    }
    const sigKey = signature.toString("base64");
    for (const [s, t] of usedSigs) if (now() - t > 2 * TIME_SKEW_S * 1000) usedSigs.delete(s);
    if (usedSigs.has(sigKey)) throw new HttpError(409, "this signed request was already used");
    usedSigs.set(sigKey, now());
    limit(L.mintPerWallet, wallet.toBase58(), "token requests from this wallet");

    let unopened = store.unopened(wallet);
    if (unopened.length >= MAX_UNOPENED) {
      // an open that confirmed after we stopped waiting isn't in our record yet
      const mints = unopened.map((m) => new PublicKey(m));
      const accs = await accountsOf(l1, mints.map((m) => presalePda(pid, m)));
      mints.forEach((m, i) => accs[i] && store.markOpened(m, presalePda(pid, m)));
      unopened = store.unopened(wallet);
      if (unopened.length >= MAX_UNOPENED) {
        throw new HttpError(429, `${unopened.length} of your tokens aren't opened yet; open one of them first`, { unopened });
      }
    }

    const pinned = await pinner.pinToken({ name, symbol, description, links, image, imageType }).catch((e) => {
      throw new HttpError(502, `IPFS: ${e.message}; try again`);
    });
    const size = launchTxSize({ pid, dbcConfig, alt, meta: { name, symbol, uri: pinned.uri } });
    if (size > PACKET) bad(`the name, symbol and link make the launch tx ${size} bytes (max ${PACKET})`);
    const key = Keypair.generate();
    store.addMint({ mint: key, creator: wallet, name, symbol, description, links, image: pinned.image, uri: pinned.uri, now: now() });
    return { status: 201, json: { mint: key.publicKey, presale: presalePda(pid, key.publicKey), name, symbol, image: pinned.image, uri: pinned.uri } };
  }

  /** The checks before a co-signed entry tx goes out: { out, tx, programs, before }. `before`
   *  is "out" when this very tx went out already (the same signed tx again: a retry, or a
   *  second request after a first that timed out), and "unknown" when that can't be told. */
  async function cosignChecked({ body, ip }) {
    limit(L.cosignPerIp, ip, "requests");
    if (typeof body.tx !== "string" || body.tx.length > 2_000) bad("tx must be a base64 transaction");
    try {
      VersionedTransaction.deserialize(Buffer.from(body.tx, "base64"));
    } catch {
      bad("tx is not a transaction");
    }
    const out = cosign(body.tx, {
      pid, gateKey, openers: openers(), validators: bot.validators, N,
      mintSigner: (m, u) => store.mintKey(m, u),
    });
    limit(L.cosignPerWallet, out.user.toBase58(), "requests from this wallet");

    const tx = out.signed;
    const keys = tx.message.staticAccountKeys;
    const programs = tx.message.compiledInstructions.map((ci) => keys[ci.programIdIndex]);
    // the client waits for this answer: a simulation the RPC doesn't answer in `simMs` ends
    // the request with nothing sent, so the open or join can be tried again
    const sim = await within(l1.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" }), simMs).catch((e) => {
      throw e?.timedOut ? new HttpError(503, "the network is slow, try again") : e;
    });
    const name = errName(sim.value.err);
    if (name === "AlreadyProcessed") return { out, tx, programs, before: "out" };
    if (name === "BlockhashNotFound") {
      // an expired blockhash, or this tx went out and its blockhash has since expired: the
      // tx's own status tells them apart
      const before = await within(l1.getSignatureStatuses([sigOf(tx)], { searchTransactionHistory: true }), simMs).then(
        (r) => (!Array.isArray(r?.value) ? "unknown" : r.value[0] ? "out" : null),
        () => "unknown",
      );
      if (before) return { out, tx, programs, before };
    }
    if (sim.value.err) {
      throw new HttpError(400, `the tx fails: ${describeTxError(sim.value.err, programs, pid, sim.value.logs)}`, { logs: sim.value.logs ?? [] });
    }
    return { out, tx, programs, before: null };
  }

  async function cosignRoute(req) {
    // every answer from before the tx goes out says `sent: false`: the client (flows.js) takes
    // those as plain failures, and any other (a proxy's 502, no answer, an error once the send
    // began) as outcome unknown
    const { out, tx, programs, before } = await cosignChecked(req).catch((e) => {
      throw unsent(e);
    });
    const reply = (sig, confirmed) => ({
      status: confirmed ? 200 : 202,
      json: { sig, confirmed, kind: out.kind, user: out.user, presale: out.presale, ...(out.mint && { mint: out.mint }) },
    });
    // this tx may have gone out before: no `sent` marker, so the client doesn't take it as a
    // plain failure
    if (before === "unknown") throw new HttpError(503, "the network is slow, try again");
    // it did: sent, not confirmed here; what the first send records (markOpened, the keeper) is
    // left to it
    if (before === "out") return reply(sigOf(tx), false);
    let sig;
    let confirmed = true;
    try {
      sig = await sendSigned(l1, tx, { ixs: programs.map((programId) => ({ programId })), pid, what: out.kind, timeoutMs: sendTimeoutMs });
    } catch (e) {
      if (!(e instanceof TxError)) throw e;
      if (!e.outcomeUnknown && !/not confirmed in time/.test(e.message)) throw new HttpError(400, e.message, { sig: e.sig, logs: e.logs });
      sig = e.sig;
      confirmed = false;
    }
    if (confirmed && out.kind === "open") {
      store.markOpened(out.mint, out.presale, now());
      keeper?.watch(out.presale); // before its next scan
    }
    if (confirmed) feed?.touch(out.presale);
    return reply(sig, confirmed);
  }

  // ---- routes ----

  const get = (path, handler) => ({ method: "GET", path, handler });
  return [
    get(/^\/api\/info$/, async () => ({
      json: {
        cluster,
        canary,
        program: pid,
        config: configPda(pid),
        gate: gateKey.publicKey,
        bot: bot.bot.publicKey,
        dbcConfig,
        alt: alt.key,
        ers: bot.validators.map((v) => ({ validator: v, url: bot.ers[v.toBase58()].rpcEndpoint })),
        numbers: N,
        // the lines a creator signs for POST /api/mint, joined with "\n" (auth.js mintMessage)
        mintMessage: [
          "Mooner: create a token",
          "wallet: <base58>",
          "name: <name>",
          "symbol: <symbol>",
          "image: <sha256 hex of the image bytes>",
          'details: <sha256 hex of JSON.stringify([description, twitter, telegram, website]), "" for a missing one>',
          "time: <unix seconds>",
        ],
      },
    })),
    { method: "POST", path: /^\/api\/mint$/, body: 3_000_000, handler: mint },
    { method: "POST", path: /^\/api\/cosign$/, body: 8_192, handler: cosignRoute },
    get(/^\/api\/presales$/, async () => ({ json: { presales: await reads.listPresales() } })),
    get(/^\/api\/launched$/, async () => ({ json: { launched: await reads.listLaunched() } })),
    get(new RegExp(`^/api/presale/${KEY}$`), async ({ params }) => ({ json: await reads.presale(parseKey(params.key, "presale")) })),
    get(new RegExp(`^/api/token/${KEY}$`), async ({ params }) => {
      const token = store.token(parseKey(params.key, "mint"));
      if (!token) throw new HttpError(404, "not a token this server issued");
      return { json: token };
    }),
    get(new RegExp(`^/api/wallet/${KEY}/tokens$`), async ({ params }) => ({ json: { tokens: store.tokensOf(parseKey(params.key, "wallet")) } })),
    get(new RegExp(`^/api/wallet/${KEY}/balance$`), async ({ params, ip }) => {
      const wallet = parseKey(params.key, "wallet");
      limit(L.balancePerIp, ip, "balance checks");
      return { json: { lamports: await reads.balance(wallet) } };
    }),
    get(/^\/api\/blockhash$/, async () => ({ json: await reads.blockhash() })),
    get(/^\/api\/health$/, async () => {
      if (now() - botBalance.at > 15_000) botBalance = { at: now(), value: await l1.getBalance(bot.bot.publicKey) };
      return { json: { ok: true, cluster, botLamports: botBalance.value, keeper: keeper?.status() ?? null, live: feed?.status() ?? null } };
    }),
  ];
}
