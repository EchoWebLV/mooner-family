// The seats a presale view lists (api.js makeReads): home seats read on Solana, delegated
// ones in the ER. A seat moving home while the listings run must stay in the view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { makeReads } from "../server/api.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE, decodeSeat } from "../src/layout.js";
import { presalePda, seatPda } from "../src/pdas.js";

const pid = Keypair.generate().publicKey;
const validator = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const mint = Keypair.generate().publicKey;
const presale = presalePda(pid, mint);

function presaleData() {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = STATE.OPEN;
  mint.toBuffer().copy(d, P.MINT);
  validator.toBuffer().copy(d, P.VALIDATOR);
  return d;
}

function seat(commit) {
  const user = Keypair.generate().publicKey;
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  user.toBuffer().copy(d, S.USER);
  presale.toBuffer().copy(d, S.PRESALE);
  d.writeBigUInt64LE(commit, S.DEPOSIT);
  d.writeBigUInt64LE(commit, S.COMMIT);
  return { key: seatPda(pid, presale, user), user, data: d };
}

// where a seat shows, by where it is: "moving" left the ER and isn't home yet; "both" is
// home on Solana while the delegated listing lags and the ER still has a copy
const SHOWS = { er: ["delegated", "er"], moving: ["delegated"], home: ["home"], both: ["delegated", "er", "home"] };

/** Reads over an open presale on Solana whose seats are where `where(seat)` says, now.
 *  `after(place)` runs after each seat listing (something lands meanwhile). */
function reads(seats, where, after = (_place) => {}) {
  const order = [];
  const at = (place) => seats.filter((s) => SHOWS[where(s)].includes(place));
  const l1 = { getMultipleAccountsInfo: async (ks) => ks.map((k) => (k.equals(presale) ? { owner: pid, data: presaleData(), lamports: 1 } : null)) };
  const er = { getMultipleAccountsInfo: async (ks) => (order.push("er"), ks.map((k) => at("er").find((s) => s.key.equals(k))).map((s) => s && { owner: pid, data: s.data, lamports: 1 })) };
  const listing = (place, fn) => async () => {
    order.push(place);
    const out = at(place).map(fn);
    after(place);
    return out;
  };
  const bot = {
    ers: { [validator.toBase58()]: er },
    listDelegatedSeats: listing("delegated", (s) => s.key),
    homeSeats: listing("home", (s) => ({ key: s.key, ...decodeSeat(s.data) })),
  };
  const store = { token: () => null, launch: () => null, tokenOfPresale: () => null };
  return { order, r: makeReads({ pid, l1, bot, store, dbcConfig: Keypair.generate().publicKey }) };
}

const shown = async ({ r }) => (await r.presale(presale)).seats.map((s) => [s.seat.toBase58(), s.where]);

test("seats: home ones, then the ones in the ER, each as the view shows it", async () => {
  const a = seat(100n);
  const b = seat(200n);
  const v = await reads([b, a], (s) => (s === a ? "home" : "er")).r.presale(presale);
  assert.deepEqual(v.seats.map((s) => [s.seat.toBase58(), s.user.toBase58(), s.deposit, s.commit, s.where, s.claimed, s.creator, s.settled]), [
    [a.key.toBase58(), a.user.toBase58(), 100n, 100n, "home", false, false, false],
    [b.key.toBase58(), b.user.toBase58(), 200n, 200n, "er", false, false, false],
  ]);
});

test("seats: one that lands home while the listings run is still there", async () => {
  const a = seat(100n);
  let now = "er";
  const x = reads([a], () => now, () => (now = "home"));
  assert.deepEqual(await shown(x), [[a.key.toBase58(), "home"]]);
  assert.deepEqual(x.order, ["delegated", "er", "home"], "the delegated listing and its ER read go first, as in bot.js seatsLeft");
});

test("seats: one that leaves the ER just after the home listing still shows in the ER", async () => {
  const a = seat(100n);
  let now = "er";
  const x = reads([a], () => now, (place) => place === "home" && (now = "moving"));
  assert.deepEqual(await shown(x), [[a.key.toBase58(), "er"]]);
});

test("seats: one in both is shown home: the owner-checked home read is the last one", async () => {
  const a = seat(100n);
  const b = seat(200n);
  assert.deepEqual(await shown(reads([a, b], (s) => (s === a ? "both" : "er"))), [[a.key.toBase58(), "home"], [b.key.toBase58(), "er"]]);
});

test("seats: one between the ER and home is in neither (the client asks Solana)", async () => {
  assert.deepEqual(await shown(reads([seat(100n)], () => "moving")), []);
});
