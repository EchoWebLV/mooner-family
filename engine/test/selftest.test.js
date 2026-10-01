// The golden txs (a v0 join, a legacy ER tx): the phone compares their digests with these.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { checkEntryTx } from "../src/cosigner.js";
import {
  COLLATION_ORDER, COLLATION_WORDS, collationOrder, digest, GOLDEN_ER_DIGEST, GOLDEN_GATE, GOLDEN_JOIN_DIGEST, GOLDEN_PID, GOLDEN_VALIDATOR, goldenErTx, goldenJoinTx,
} from "../src/selftest.js";

test("the golden join tx has the digest the phone checks against", () => {
  const tx = goldenJoinTx();
  assert.equal(digest(tx), GOLDEN_JOIN_DIGEST);
  assert.equal(digest(tx), crypto.createHash("sha256").update(tx.serialize()).digest("hex"));
});

test("the golden ER tx (legacy, as the ER takes) has the digest the phone checks against", () => {
  const tx = goldenErTx();
  assert.equal(tx.constructor.name, "Transaction");
  assert.equal(digest(tx), GOLDEN_ER_DIGEST);
  assert.equal(digest(tx), crypto.createHash("sha256").update(tx.serialize()).digest("hex"));
});

test("the golden ER tx's digest depends on how web3.js orders a legacy tx's accounts", () => {
  // web3.js sorts them with localeCompare; an engine that compares code points instead puts
  // two of the tx's keys the other way round, and the phone's check must catch that
  const icu = digest(goldenErTx());
  const localeCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function (other) {
    return this < other ? -1 : this > other ? 1 : 0;
  };
  try {
    assert.notEqual(digest(goldenErTx()), icu);
  } finally {
    String.prototype.localeCompare = localeCompare;
  }
});

// the probe with String.prototype.localeCompare swapped for `compare`, put back after
function probeWith(compare) {
  const localeCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = compare;
  try {
    return collationOrder();
  } finally {
    String.prototype.localeCompare = localeCompare;
  }
}
const localeCompare = String.prototype.localeCompare;
const byLocale = (locale, change = {}) => function (other, _en, options) {
  return localeCompare.call(this, other, locale, { ...options, ...change });
};

test("the collation probe sorts its words as Node does, and fires under code point, numeric order or another locale", () => {
  assert.ok(COLLATION_WORDS.every((w) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(w))); // base58, like the keys web3.js sorts
  assert.deepEqual(collationOrder(), COLLATION_ORDER);
  const codePoint = function (other) {
    return this < other ? -1 : this > other ? 1 : 0;
  };
  assert.notDeepEqual(probeWith(codePoint), COLLATION_ORDER, "code point");
  assert.notDeepEqual(probeWith(byLocale("en", { numeric: true })), COLLATION_ORDER, "numeric");
  // every locale selftest.js names beside the words
  const others = ["da", "nb", "cs", "sk", "hu", "hr", "bs", "sr-Latn", "fil", "tl", "ceb", "to", "yo", "ig", "ee", "sq", "ha", "az", "lt", "et", "haw", "ln-u-co-phonetic"];
  for (const locale of others) assert.notDeepEqual(probeWith(byLocale(locale)), COLLATION_ORDER, locale);
});

test("the collation probe stays quiet under en, en-US, en-GB and en without options", () => {
  for (const locale of ["en", "en-US", "en-GB"]) assert.deepEqual(probeWith(byLocale(locale)), COLLATION_ORDER, locale);
  const noOptions = function (other) {
    return localeCompare.call(this, other, "en");
  };
  assert.deepEqual(probeWith(noOptions), COLLATION_ORDER, "no options");
});

test("the golden join tx is a join the gate would sign", () => {
  const r = checkEntryTx(goldenJoinTx(), { pid: GOLDEN_PID, gate: GOLDEN_GATE, validators: [GOLDEN_VALIDATOR] });
  assert.equal(r.kind, "join");
});
