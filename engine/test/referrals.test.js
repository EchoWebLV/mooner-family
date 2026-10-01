// The referrals table: one row per seat. A join that confirmed keeps its referrer; one sent
// but not confirmed in time is noted unconfirmed and gives way to the seat's next join.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { Referrals } from "../server/referrals.js";

const key = () => Keypair.generate().publicKey;

test("Referrals: an unconfirmed row gives way, a confirmed one stays; kept beside the server's other records", () => {
  const store = new Store(":memory:");
  const refs = new Referrals(store.db);
  const [presale, user, a, b, c] = [key(), key(), key(), key(), key()];
  assert.equal(refs.referralOf(presale, user), null);

  refs.add(presale, user, a, "SIG1", 1, false);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: a.toBase58(), sig: "SIG1", at: 1, confirmed: false }, "a 202: noted, unconfirmed");
  refs.add(presale, user, b, "SIG2", 2, false);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: b.toBase58(), sig: "SIG2", at: 2, confirmed: false }, "another 202 replaces it");
  refs.add(presale, user, c, "SIG3", 3, true);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: c.toBase58(), sig: "SIG3", at: 3, confirmed: true }, "a 200 replaces an unconfirmed row");
  refs.add(presale, user, a, "SIG4", 4, true);
  refs.add(presale, user, b, "SIG5", 5, false);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: c.toBase58(), sig: "SIG3", at: 3, confirmed: true }, "a confirmed row is never replaced");

  const other = key();
  refs.add(other, user, b, "SIG6", 6, true);
  assert.equal(refs.referralOf(other, user).referrer, b.toBase58(), "another presale is another seat");
  assert.equal(new Referrals(store.db).referralOf(presale, user).referrer, c.toBase58(), "a second open of the same file keeps the rows");
  store.close();
});
