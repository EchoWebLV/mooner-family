// Everything a Mooner app does on chain, shared by the web app and the phone app. Entry
// txs (open, join) are signed by the wallet and sent by the server, which co-signs them.
// Joining commits the whole deposit in the presale's MagicBlock ER (set_commit, signed by
// a session key kept on this device: free, no popup). Getting it back is one step for the
// user: set_commit 0 + leave in the ER, then settle_seat on Solana, which the wallet signs
// and the app sends. Each app hands in its API client, its live socket and a key store.
// No node: imports (Buffer is global: Node, or the app's polyfill).

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DELEGATION_PROGRAM, describeTxError, ERRORS, failedWith } from "./consts.js";
import * as I from "./ix.js";
import { decodePresale, decodeSeat, PRESALE_LEN, SEAT_LEN, STATE } from "./layout.js";
import { presalePda, seatPda } from "./pdas.js";
import { connect, outcomeUnknown, send, sendSigned, sigOf, timedFetch, TxError } from "./tx.js";
import { cutToRoom, joinIxs, mintMessageText, openIxs, unsignedTx, validSeat } from "./client.js";

/** Solana's public RPC for each cluster the server runs on (/api/info `cluster`). */
export const PUBLIC_RPCS = { mainnet: "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" };
export const PUBLIC_RPC = PUBLIC_RPCS.mainnet;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** `p`, or an error once `ms` pass. */
function timed(p, ms, what) {
  let t;
  const late = new Promise((_, no) => (t = setTimeout(() => no(new Error(`${what} didn't answer; try again`)), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

export const LAMPORTS = 1_000_000_000n;
export const sol = (lamports, digits = 2) => {
  const v = Number(BigInt(lamports)) / 1e9;
  return v.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};
export const toLamports = (s) => BigInt(Math.round(Number(s) * 1e9));

/** µLamports per compute unit the entry txs pay. */
export const PRIORITY = 50_000;
// What a join takes besides the deposit, and so what the apps check the wallet holds: the
// seat's rent; the delegation record's (96 bytes) and metadata's (133); the fee; and a 0-byte
// account's rent, which the wallet must keep. The fee is 2 signatures and 403,000 CU (the price
// ix's 3,000, 200,000 a Mooner ix) plus WALLET_CU, at the higher of the price the tx is built at
// and WALLET_PRICE, rounded up. That is because a wallet may raise the price (Seed Vault raises
// any lower price to 100,000) and add Lighthouse ixs (the gate lets them through,
// cosigner.js); as the txs set no CU limit, each one raises the default limit by 200,000 CU (it
// signs nothing). Solflare adds two (entry.test.js), so two are counted; that also covers
// Seed Vault, which sets a limit 20,000 CU above what the tx needs for its one. An open is counted the
// same way: the presale's rent too, a record and metadata (sized by its seeds, below) for each
// of the two accounts it delegates, and 3 signatures (the wallet's, the gate's, the mint's) on
// 603,000 CU.
const RECORD_LEN = 96;
// Delegation metadata: discriminator 8, last commit id 8, undelegation requester 1, rent
// payer 32, then the account's seeds as delegate() passes them (no bump, entry.rs), a Vec of
// Vecs: 4, and 4 + each seed's length (magicblock-delegation-program-api 3.1.0,
// delegation_metadata.rs serialized_size). Canary open D9eueWee… paid rent for 100 and 133.
const metadataLen = (...seeds) => 8 + 8 + 1 + 32 + 4 + seeds.reduce((n, len) => n + 4 + len, 0);
const PRESALE_METADATA_LEN = metadataLen("presale".length, 32); // ["presale", mint]: 100
const SEAT_METADATA_LEN = metadataLen("seat".length, 32, 32); // ["seat", presale, user]: 133
const WALLET_CU = 2n * 200_000n;
const WALLET_PRICE = 100_000n; // Seed Vault raises any lower price to this (spec, Answers 2026-10-01)
const entryFee = (signatures, cu, priority) => {
  const price = BigInt(priority) > WALLET_PRICE ? BigInt(priority) : WALLET_PRICE;
  return signatures * 5_000n + ((cu + WALLET_CU) * price + 999_999n) / 1_000_000n;
};
export const joinFee = (priority = PRIORITY) => entryFee(2n, 403_000n, priority);
export const openFee = (priority = PRIORITY) => entryFee(3n, 603_000n, priority);
const rents = new Map(); // "<rpc> <bytes>" -> lamports; a read that fails or hangs isn't kept
/** A Connection to Solana at `url` whose requests give up after 10 s (tx.js timedFetch). */
const solana = (url) => new Connection(url, { commitment: "confirmed", fetch: timedFetch });

/** Rent for `bytes` as `rpc` (a URL or a Connection) says, read once. A read gets 10 s: a
 *  Connection handed in may never give up, and a hung read kept here would hang every later cost. */
function rentOn(rpc) {
  const conn = typeof rpc === "string" ? solana(rpc) : rpc;
  return (bytes) => {
    const k = `${conn.rpcEndpoint} ${bytes}`;
    const read = () => timed(conn.getMinimumBalanceForRentExemption(bytes), 10_000, "Solana");
    if (!rents.has(k)) rents.set(k, read().then(BigInt, (e) => (rents.delete(k), Promise.reject(e))));
    return rents.get(k);
  };
}

/** What a join takes from the wallet besides the deposit, in lamports: { seat, delegation,
 *  fee, keep, total }. Rents come from `rpc` (a URL or a Connection). */
export async function joinCost({ rpc = PUBLIC_RPC, priority = PRIORITY } = {}) {
  const [seat, record, metadata, keep] = await Promise.all([SEAT_LEN, RECORD_LEN, SEAT_METADATA_LEN, 0].map(rentOn(rpc)));
  const fee = joinFee(priority);
  return { seat, delegation: record + metadata, fee, keep, total: seat + record + metadata + fee + keep };
}

/** What an open takes from the wallet besides the creator's commit, in lamports: { presale,
 *  seat, delegation, fee, keep, total }. Rents come from `rpc` (a URL or a Connection). */
export async function openCost({ rpc = PUBLIC_RPC, priority = PRIORITY } = {}) {
  const lens = [PRESALE_LEN, SEAT_LEN, RECORD_LEN, PRESALE_METADATA_LEN, SEAT_METADATA_LEN, 0];
  const [presale, seat, record, presaleMeta, seatMeta, keep] = await Promise.all(lens.map(rentOn(rpc)));
  const delegation = 2n * record + presaleMeta + seatMeta;
  const fee = openFee(priority);
  return { presale, seat, delegation, fee, keep, total: presale + seat + delegation + fee + keep };
}

/** Where a seat's session key is kept: one per presale and wallet. */
export const sessionKeyName = (presale, wallet) => `mooner:session:${presale}:${wallet}`;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const sha256hex = (bytes) => bytesToHex(sha256(bytes));
/** UTF-8 bytes as a plain Uint8Array: what wallets expect (a Buffer serializes differently as JSON). */
const utf8 = (text) => Uint8Array.from(Buffer.from(text, "utf8"));

/** What getBack says when the SOL can't come back from here (it sends nothing then). */
const FILLED = "The pool filled: your SOL is in and turns into tokens at launch.";
const BY_ITSELF = "It comes back to your wallet by itself.";
const CLAIMED = "Your seat was claimed at launch: the tokens are in your wallet.";
const AT_LAUNCH = "Your seat was settled at launch: its tokens or SOL are in your wallet.";
const SETTLED_ANY = "Your seat was settled: its SOL or tokens are in your wallet.";
const UNREACHABLE = "couldn't reach Solana to check your seat; try again";

/** An error as one readable line, with the program's error names. */
const PLAIN = {
  NoRoom: "The pool is already full.",
  PastDeadline: "Time's up for this presale.",
  BadState: "This presale isn't open any more.",
  CreatorCannotLower: "The creator can't lower or take back their SOL.",
  OverDeposit: "That's more than you put in.",
  BadSeatSize: "That amount isn't allowed.",
  NotAuthorized: "This wallet can't change that seat.",
  CommitNotZero: "Take your SOL out of the pool first.",
  GateRequired: "The server didn't sign this.",
  NotHome: "Your seat is still on its way back to Solana; try again in a moment.",
  AlreadySettled: FILLED,
};

/** Names only: a bare `custom program error: 0x6` could be any program's (a Jupiter
 *  trade's too); `named` gives Mooner's own codes their names. */
export function explain(e) {
  const m = e?.message ?? String(e);
  if (e?.outcomeUnknown) return m; // tx.js OUTCOME_UNKNOWN: it may have landed
  if (/User rejected|rejected the request|declined|cancel/i.test(m)) return "You cancelled it in your wallet.";
  // the runtime's words and System's (Token's bare "insufficient funds" is about tokens)
  if (/insufficient funds for (fee|rent)|no record of a prior credit|insufficient lamports/i.test(m)) return "Your wallet needs a little more SOL to cover rent and the Solana fee.";
  const name = Object.keys(PLAIN).find((k) => m.includes(k));
  return name ? PLAIN[name] : m;
}

/** A failed preflight of a Mooner tx, with the program's error name if the code is its
 *  own. The code alone doesn't say whose it is: the first `Program <id> failed` line in
 *  the logs does (a program Mooner calls fails before Mooner does). */
function named(e, pid) {
  const by = failedWith([...(e?.logs ?? []), e?.message]);
  const name = by?.program === pid.toBase58() && ERRORS[by.code];
  return name ? new Error(`${e.message} (${name})`) : e;
}

/** Why SOL in the pool can't come back from here, or null if it can. `now`: the presale
 *  as getBack reads it, { home, p } (null: the read failed). A seat still in the ER takes
 *  it out with set_commit 0, OPEN and before the deadline only (ledger.rs); a home seat
 *  gets it with settle_seat, which pays it out only from a presale that's home, EXPIRED
 *  or FAILED (settle_seat.rs). */
function held(now, inEr) {
  if (!now) return "Couldn't read the presale; try again in a moment.";
  const { home, p } = now;
  if (p.state === STATE.FULL || p.state === STATE.LAUNCHING || p.state === STATE.SETTLED) return FILLED;
  // a committed seat comes home only once the presale isn't OPEN (commit_seats): this is
  // a read that raced a change, and a new delegation would only lock the seat away again
  if (p.state === STATE.OPEN && !inEr) return "Your seat isn't back yet; try again in a moment.";
  // set_commit takes nothing out from the deadline on (ledger.rs): the keeper expires it
  if (p.state === STATE.OPEN) return p.deadlineTs <= Math.floor(Date.now() / 1000) ? BY_ITSELF : null;
  return home && !inEr ? null : BY_ITSELF; // EXPIRED or FAILED: the keeper sends seats home and refunds them
}

export const erFor = (info, validator) => info.ers.find((e) => e.validator.equals(new PublicKey(validator)));

/** The ER that answers fastest from here; a new presale lives there. */
export async function nearestEr(info) {
  const timed = info.ers.map(async (e) => {
    const t0 = performance.now();
    await e.conn.getSlot();
    return { e, ms: performance.now() - t0 };
  });
  const ok = (await Promise.allSettled(timed)).filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw new Error("no MagicBlock ER answered; try again");
  return ok.sort((a, b) => a.ms - b.ms)[0].e;
}

/** The seat as the ER holds it right now (null if it isn't there). */
async function erSeat(er, seat, pid) {
  const a = await er.conn.getAccountInfo(seat);
  return a?.owner.equals(pid) ? decodeSeat(a.data) : null;
}

/** A tx the wallet itself signs, sent to the ER (free). */
async function walletErTx({ info, er, wallet, signTransaction, ixs, what }) {
  const { blockhash } = await er.conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: wallet, recentBlockhash: blockhash }).add(...ixs);
  const signed = await signTransaction(tx);
  return sendSigned(er.conn, signed, { ixs, pid: info.pid, what, timeoutMs: 30_000 });
}

/** Whether the ER would refuse `ixs` from `signer`: null if not, else { ours, text },
 *  where `ours` means Mooner's program said no (another signer can't change that). */
async function erRefuses(conn, ixs, signer, pid) {
  try {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(...ixs);
    const r = (await conn.simulateTransaction(tx, [signer])).value;
    if (!r.err) return null;
    const text = describeTxError(r.err, ixs.map((i) => i.programId), pid, r.logs);
    return { ours: /^ix \d+: (?!unknown)/.test(text), text };
  } catch (e) {
    return { ours: false, text: e?.message ?? String(e) };
  }
}

/**
 * The flows for one app. `api`: makeApi(); `subscribe(topic, fn)` -> off: the live socket;
 * `keys`: { get(name), set(name, value) } (async, may throw: keys are kept in memory too,
 * so a store that fails costs a wallet signature only once the app restarts); `priority`:
 * micro-lamports per CU on entry txs; `rpc`: Solana, as a URL or a Connection (default: the
 * public RPC of the server's cluster): getBack reads the seat there and sends settle_seat
 * on it (the wallet signs), and joinCost and openCost read rent there.
 */
export function makeFlows({ api, subscribe, keys, priority = PRIORITY, rpc = null }) {
  if (typeof keys?.get !== "function" || typeof keys?.set !== "function") throw new Error("makeFlows needs keys: { get(name), set(name, value) }");

  // ---- server info ----

  let infoP = null;
  /** /api/info with keys as PublicKeys, numbers as BigInt and a Connection per ER. A request
   *  that fails, or hangs for 10 s, isn't kept, so the next call asks again. */
  function loadInfo() {
    infoP ??= timed(api.info(), 10_000, "the server").then((i) => ({
      ...i,
      pid: new PublicKey(i.program),
      gate: new PublicKey(i.gate),
      N: Object.fromEntries(Object.entries(i.numbers).map(([k, v]) => [k, typeof v === "string" ? BigInt(v) : v])),
      ers: i.ers.map((e) => ({ validator: new PublicKey(e.validator), url: e.url, conn: connect(e.url, { fetch: timedFetch }) })),
    })).catch((e) => {
      infoP = null;
      throw e;
    });
    return infoP;
  }

  // ---- session keys: one per presale and wallet, on this device ----

  const made = new Map(); // name -> Keypair: every key saved here, for a store that fails
  const unsaved = new Set(); // names whose last save failed: the store may hold an older key

  async function sessionKey(presale, wallet) {
    const name = sessionKeyName(presale, wallet);
    if (!unsaved.has(name)) {
      try {
        const s = await keys.get(name);
        if (s) return Keypair.fromSecretKey(Buffer.from(s, "base64"));
      } catch {
        // no storage: the one kept in memory, if any
      }
    }
    return made.get(name) ?? null;
  }

  async function saveSessionKey(presale, wallet, kp) {
    const name = sessionKeyName(presale, wallet);
    made.set(name, kp);
    try {
      await keys.set(name, b64(kp.secretKey));
      unsaved.delete(name);
    } catch {
      // no storage: it lasts as long as the app; after that the wallet signs a rotate_key
      unsaved.add(name);
    }
    return kp;
  }

  /** The key this device has for the seat, or a new one, saved before any tx carries it: a
   *  retry after an unknown outcome must send the key the landed tx may already hold. */
  const keyFor = async (presale, wallet) => (await sessionKey(presale, wallet)) ?? (await saveSessionKey(presale, wallet, Keypair.generate()));

  /** Signs an entry tx with the wallet and hands it to the server, which co-signs and sends
   *  it. Returns the server's reply once it's confirmed (or sent, if slow). A cosign the
   *  server didn't answer in time (apiclient.js) may still have been sent: outcome unknown. */
  async function signAndCosign(signTransaction, payer, ixs) {
    const { blockhash } = await api.blockhash();
    const tx = unsignedTx({ ixs: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }), ...ixs], payer, blockhash });
    const signed = await signTransaction(tx);
    const r = await api.cosign(b64(signed.serialize())).catch((e) => {
      throw e?.timedOut && e.status === 0 ? outcomeUnknown(sigOf(signed), "cosign") : e;
    });
    return r.json;
  }

  /** Waits until `done(view)` holds for the presale, as the server pushes it. It reads
   *  once too: the change may already be there. `done` may be async; a throw ends the wait
   *  with that error. */
  function waitFor(presale, done, { timeoutMs = 90_000, what = "the change" } = {}) {
    const key = presale.toString();
    return new Promise((resolve, reject) => {
      let over = false;
      let off = null;
      let timer = null;
      const end = (settle) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        settle();
        try {
          off?.();
        } catch {}
      };
      const check = async (v) => {
        try {
          if (!over && (await done(v))) end(() => resolve(v));
        } catch (e) {
          end(() => reject(e));
        }
      };
      // a socket may hand over a snapshot inside subscribe(): off isn't set yet then
      off = subscribe(`presale:${key}`, (m) => m.type === "snapshot" && check(m.data));
      if (over) return off();
      timer = setTimeout(() => end(() => reject(new Error(`${what} didn't show up yet; refresh in a moment`))), timeoutMs);
      api.presale(key).then(check, () => {});
    });
  }

  // ---- open ----

  /** Asks the server for a token (the wallet signs the details). The server trims text the
   *  same way, so the signature covers what it stores. */
  async function requestMint({ wallet, signMessage, name, symbol, description, links, image }) {
    const t = {
      name: name.trim(),
      symbol: symbol.trim(),
      description: description.trim(),
      links: { twitter: links.twitter.trim(), telegram: links.telegram.trim(), website: links.website.trim() },
    };
    const time = Math.floor(Date.now() / 1000);
    const details = [t.description, t.links.twitter, t.links.telegram, t.links.website];
    const text = mintMessageText({
      wallet, name: t.name, symbol: t.symbol, time,
      imageHash: sha256hex(image),
      detailsHash: sha256hex(utf8(JSON.stringify(details))),
    });
    const signature = await signMessage(utf8(text));
    const links2 = Object.fromEntries(Object.entries(t.links).filter(([, v]) => v));
    return api.mint({ wallet: wallet.toBase58(), ...t, links: links2, image: b64(image), time, signature: b64(signature) });
  }

  /** open_presale + delegations, with the creator's commit (which is also their deposit). */
  async function openPresale({ info, wallet, signTransaction, mint, commit }) {
    if (!validSeat(commit, info.N)) throw new Error(`pick ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)} SOL`);
    // the co-signer refuses a creator deposit over this (cosigner.js): at least one other seat fits
    const cap = info.N.TARGET - info.N.MIN_SEAT;
    if (commit > cap) throw new Error(`the creator can put in at most ${sol(cap)} SOL, so others can join`);
    const mintKey = new PublicKey(mint);
    const presale = presalePda(info.pid, mintKey);
    const er = await nearestEr(info);
    const sk = await keyFor(presale.toBase58(), wallet.toBase58());
    const ixs = openIxs(info.pid, {
      creator: wallet, gate: info.gate, mint: mintKey, feeDest: wallet, sessionKey: sk.publicKey,
      deposit: commit, commit, validator: er.validator,
    });
    const r = await signAndCosign(signTransaction, wallet, ixs);
    if (!r.confirmed) await waitFor(presale, (v) => v.where !== "closed", { what: "the presale" });
    return presale;
  }

  // ---- join and the ledger ----

  /** join + delegate(seat), then commit the whole deposit in the ER. */
  async function joinPresale({ info, wallet, signTransaction, view, amount, onStep = (_what) => {} }) {
    if (!validSeat(amount, info.N)) throw new Error(`pick ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)} SOL`);
    const presale = new PublicKey(view.presale);
    const sk = await keyFor(view.presale, wallet.toBase58());
    onStep("Sign in your wallet to put the SOL in");
    const ixs = joinIxs(info.pid, { user: wallet, gate: info.gate, presale, sessionKey: sk.publicKey, deposit: amount, validator: new PublicKey(view.validator) });
    const r = await signAndCosign(signTransaction, wallet, ixs);
    if (!r.confirmed) await waitFor(presale, (v) => v.seats?.some((s) => s.user === wallet.toBase58()), { what: "your seat" });
    onStep("Counting you in");
    return setCommit({ info, wallet, signTransaction, view, amount, retries: 8, key: sk });
  }

  const rotating = new Map(); // name -> the rotate_key under way: two at once share it

  /** A session key the seat accepts: `key` (one the caller knows), else the stored one, or
   *  a new one the wallet sets (rotate_key in the ER, one signature). */
  async function usableKey({ info, wallet, signTransaction, er, presale, seat, key }) {
    const [p, w] = [presale.toBase58(), wallet.toBase58()];
    const name = sessionKeyName(p, w);
    const takes = (s, sk) => sk && (!s || s.sessionKey.equals(sk.publicKey)); // not in the ER yet: set_commit retries
    const s = await erSeat(er, seat, info.pid);
    const sk = key ?? (await sessionKey(p, w));
    if (takes(s, sk)) return sk;
    if (!rotating.has(name)) {
      const rotate = async () => {
        // read again inside the lock: a rotation that ended since the read above set it already
        const mine = await sessionKey(p, w);
        if (takes(await erSeat(er, seat, info.pid), mine)) return mine;
        // kept first: once the wallet sends it, the seat may hold it whatever we hear back
        const fresh = await saveSessionKey(p, w, Keypair.generate());
        const ixs = [I.rotateKey(info.pid, { user: wallet, seat, key: fresh.publicKey })];
        await walletErTx({ info, er, wallet, signTransaction, ixs, what: "rotate_key" });
        return fresh;
      };
      rotating.set(name, rotate().finally(() => rotating.delete(name)));
    }
    return rotating.get(name);
  }

  /** set_commit in the ER: `amount` 0 takes it all back. The program cuts a raise to the
   *  room left; the result shows in the next read. `key`: the seat's session key, if the
   *  caller knows it (a join does). */
  async function setCommit({ info, wallet, signTransaction, view, amount, retries = 2, key = null }) {
    if (amount !== 0n && !validSeat(amount, info.N)) throw new Error(`pick ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)} SOL, or 0`);
    const presale = new PublicKey(view.presale);
    const seat = seatPda(info.pid, presale, wallet);
    const er = erFor(info, view.validator);
    if (!er) throw new Error("this presale's ER isn't one the server knows");
    const mine = view.seats?.find((s) => s.user === wallet.toBase58());
    if (mine && amount !== 0n) {
      const others = BigInt(view.raised) - BigInt(mine.commit);
      if (cutToRoom(amount, BigInt(mine.commit), others, info.N.TARGET) === null) throw new Error("the pool is full");
    }
    for (let i = 0; ; i++) {
      try {
        key = await usableKey({ info, wallet, signTransaction, er, presale, seat, key });
        return await send(er.conn, { ixs: [I.setCommit(info.pid, { signer: key.publicKey, seat, presale, amount })], payer: key, legacy: true, pid: info.pid, what: "set_commit", timeoutMs: 30_000 });
      } catch (e) {
        // a seat delegated moments ago may not be in the ER yet
        if (i >= retries || /NotAuthorized|BadState|PastDeadline|OverDeposit|NoRoom|CreatorCannotLower|BadSeatSize|rejected/i.test(e.message)) throw e;
        await sleep(1_500);
      }
    }
  }

  /** Takes the seat out of the pool and out of the ER in one ER tx (free): set_commit 0, if
   *  anything is committed, then leave. The session key signs it, so there's no popup; if
   *  this device has no key for the seat, or the ER wants a payer with SOL, the wallet signs. */
  async function leaveEr({ info, er, wallet, signTransaction, presale, seat, s, onStep }) {
    const ixs = (signer) => [
      ...(s.commit > 0n ? [I.setCommit(info.pid, { signer, seat, presale, amount: 0n })] : []),
      I.leave(info.pid, { payer: signer, seat }),
    ];
    const sk = await sessionKey(presale.toBase58(), wallet.toBase58());
    if (sk && s.sessionKey.equals(sk.publicKey)) {
      const no = await erRefuses(er.conn, ixs(sk.publicKey), sk, info.pid);
      if (!no) return send(er.conn, { ixs: ixs(sk.publicKey), payer: sk, legacy: true, pid: info.pid, what: "leave", timeoutMs: 30_000 });
      if (no.ours) throw new Error(no.text);
    }
    onStep("Sign in your wallet to take your SOL out");
    return walletErTx({ info, er, wallet, signTransaction, ixs: ixs(wallet), what: "leave" });
  }

  /** Solana for this server: the app's `rpc`, else the public RPC of its cluster. */
  function solanaFor(info) {
    const r = rpc ?? PUBLIC_RPCS[info.cluster];
    if (!r) throw new Error(`no public Solana RPC for the server's cluster (${info.cluster})`);
    return typeof r === "string" ? solana(r) : r;
  }

  /** Get my SOL back: the one button. The seat leaves the pool and the ER, and once it's
   *  home on Solana, settle_seat pays the whole deposit plus the seat's rent to the wallet
   *  with no Mooner fee (the wallet pays the Solana fee). Returns once it's confirmed. SOL
   *  still in the pool comes back only from an OPEN presale (before its deadline) or a
   *  home one that's EXPIRED or FAILED; otherwise it throws a plain line and sends nothing.
   *  A seat Solana no longer has was settled already: it returns, unless the presale
   *  launched and the seat may have had SOL in the pool, or that isn't known (then it says so).
   *  The wallet only signs; the app sends (tx.js sendSigned). `sendTransaction` isn't used:
   *  it's still taken so callers that pass it (the web's, the phone's) type-check. */
  async function getBack({ info, wallet, signTransaction, sendTransaction: _unused, view, onStep = (_what) => {} }) {
    onStep("Checking your seat");
    const presale = new PublicKey(view.presale);
    const seat = seatPda(info.pid, presale, wallet);
    const conn = solanaFor(info);
    const mine = (v) => v?.seats?.find((s) => s.user === wallet.toBase58());
    // Where Solana has the seat: "gone" (settled, refunded or claimed), "home" (owned
    // by the program again: what settle_seat checks; `s` is the seat), "away" (delegated),
    // or "unknown" (the read failed). A view can miss a seat on its way home, so only Solana
    // says it's gone.
    const onSolana = () =>
      timed(conn.getAccountInfo(seat, "confirmed"), 10_000, "Solana").then(
        (a) => (a === null ? { at: "gone" } : a.owner.equals(info.pid) ? { at: "home", s: decodeSeat(a.data) } : { at: "away" }),
        () => ({ at: "unknown" }),
      );
    // The presale now: Solana's copy once it's home, else the ER's (the live one). None on
    // Solana: it closed. If Solana doesn't answer (a = undefined), a seat in the ER goes by
    // the ER's copy: it's the one set_commit checks.
    const presaleNow = async (inEr) => {
      try {
        const a = await timed(conn.getAccountInfo(presale, "confirmed"), 10_000, "Solana").catch((e) => {
          if (inEr) return undefined;
          throw e;
        });
        if (a?.owner.equals(info.pid)) return { home: true, p: decodePresale(a.data) };
        const er = a === null ? null : erFor(info, view.validator);
        const e = er && (await timed(er.conn.getAccountInfo(presale), 10_000, "the presale's ER"));
        return e?.owner.equals(info.pid) ? { home: false, p: decodePresale(e.data) } : null;
      } catch {
        return null;
      }
    };
    const mayTake = async (inEr) => {
      const no = held(await presaleNow(inEr), inEr);
      if (no) throw new Error(no);
    };
    const had = mine(view); // the seat as the view getBack was handed lists it
    const hadCommit = had ? BigInt(had.commit ?? 0) : null; // null: not known
    // Whether the presale launched, as Solana has it (null: not known): SETTLED there, not
    // while it's in the ER (only a presale that's home launches), and once it's closed (none
    // there, or System's if someone sent SOL to it since), as the server's view says if it
    // answers.
    const launchedOnSolana = async () => {
      const a = await timed(conn.getAccountInfo(presale, "confirmed"), 10_000, "Solana").catch(() => undefined);
      if (a === undefined) return null;
      if (a?.owner.equals(info.pid)) return decodePresale(a.data).state === STATE.SETTLED;
      if (a?.owner.equals(DELEGATION_PROGRAM)) return false;
      const v = await timed(api.presale(presale.toBase58()), 10_000, "the server").catch(() => null);
      return v?.state === "CLOSED" ? Boolean(v.launch) : null;
    };
    // Solana no longer has the seat: settled, which is a refund, unless the presale launched
    // and the seat had SOL in the pool: then the keeper claimed it, and paid tokens. A view
    // that isn't final yet (OPEN, FULL, LAUNCHING) may be behind: Solana decides then.
    const gone = async (commit) => {
      if (commit === 0n) return;
      const final = { SETTLED: true, EXPIRED: false, FAILED: false, CLOSED: Boolean(view.launch) }[view.state];
      const launched = final ?? (commit === null ? false : await launchedOnSolana());
      if (launched === false) return;
      throw new Error(launched === null ? SETTLED_ANY : commit === null ? AT_LAUNCH : CLAIMED);
    };
    let now = await onSolana();
    // one "gone" while the view lists the seat may be an RPC that's behind: ask again once
    // the server's view (cached 2 s, api.js) has caught up, and believe it if both agree
    if (now.at === "gone" && had) {
      await sleep(2_000);
      now = await onSolana();
      if (now.at === "unknown") throw new Error(UNREACHABLE);
    }
    if (now.at === "gone") return await gone(hadCommit);
    let commit; // what the home seat has in the pool
    // the view decides only when Solana didn't answer
    if (now.at === "home" || (now.at === "unknown" && mine(view)?.where === "home")) {
      commit = now.s?.commit ?? BigInt(mine(view).commit ?? 0);
    } else {
      const er = erFor(info, view.validator);
      if (!er) throw new Error("this presale's ER isn't one the server knows");
      const s = await timed(erSeat(er, seat, info.pid), 10_000, "the presale's ER");
      // not in the ER any more: it left already and is on its way home
      if (s) {
        if (s.commit > 0n) await mayTake(true);
        onStep("Taking your SOL out");
        await leaveEr({ info, er, wallet, signTransaction, presale, seat, s, onStep }).catch(async (e) => {
          // past the deadline the keeper expires the presale and refunds the seat; one that
          // filled since the check keeps the SOL
          if (/PastDeadline/.test(e.message)) throw new Error(BY_ITSELF);
          if (/BadState/.test(e.message)) await mayTake(true);
          throw e;
        });
      }
      onStep("Bringing it back to Solana");
      let found = null; // what Solana said when it ended the wait
      let unanswered = false; // Solana's newest read failed
      // reads are numbered: an older one that ends late doesn't change `unanswered`
      let asked = 0;
      let heard = 0;
      const landed = async (v) => {
        const n = ++asked;
        const got = mine(v) ? null : await onSolana();
        if (n > heard) {
          heard = n;
          unanswered = got?.at === "unknown";
        }
        if (!got) return mine(v).where === "home";
        if (got.at === "gone" || got.at === "home") found = got;
        return found !== null;
      };
      view = await waitFor(presale, landed, { what: "your seat on Solana", timeoutMs: 120_000 }).catch((e) => {
        throw unanswered ? new Error(UNREACHABLE) : e;
      });
      const listed = mine(view)?.where === "home";
      // the keeper settled it already; after the leave above it had nothing in the pool
      if (!listed && found.at === "gone") return await gone(s ? 0n : hadCommit);
      commit = listed ? BigInt(mine(view).commit ?? 0) : found.s.commit;
    }
    // settle_seat would take SOL in the pool into a FULL presale: not a refund
    if (commit > 0n) await mayTake(false);
    onStep("Sending it to your wallet");
    const { blockhash, lastValidBlockHeight } = await api.blockhash();
    const ixs = [I.settleSeat(info.pid, { cranker: wallet, seat, user: wallet, presale })];
    const signed = await signTransaction(unsignedTx({ ixs, payer: wallet, blockhash }));
    // simulated first (a settle the program would refuse isn't sent), then sent again until
    // it lands or its blockhash runs out; never signed again. One that can't be told either
    // way is outcome unknown, as it is.
    await sendSigned(conn, signed, { lastValidBlockHeight, preflight: true, ixs, pid: info.pid, what: "refund" }).catch((e) => {
      if (e?.outcomeUnknown) throw e;
      if (e instanceof TxError) throw new Error(`the refund failed: ${e.reason}`);
      throw named(e, info.pid); // the preflight refused it: nothing went out
    });
    // confirmed: the seat is closed. A seat with nothing committed closes without touching
    // the presale, so no push follows; the caller drops it from what it shows.
  }

  /** What a join takes besides the deposit, counted at this app's `priority`, with rents from
   *  the same Solana RPC getBack reads: so the check and the send can't use different prices. */
  const joinCostHere = async () => joinCost({ rpc: solanaFor(await loadInfo()), priority });
  /** What an open takes besides the commit: as joinCost. */
  const openCostHere = async () => openCost({ rpc: solanaFor(await loadInfo()), priority });

  return { loadInfo, sessionKey, waitFor, requestMint, openPresale, joinPresale, setCommit, getBack, joinCost: joinCostHere, openCost: openCostHere };
}
