// The share-link helpers both apps use: which ref a device keeps and sends, and the link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REFS, cleanRef, refFor, shareLink, withRef, withoutRef } from "../src/refs.js";

const P = "P".repeat(44);
const Q = "Q".repeat(44);
const A = "A".repeat(44);
const B = "B".repeat(44);

test("cleanRef: a base58 wallet, trimmed; anything else is null", () => {
  assert.equal(cleanRef(` ${A}\n`), A);
  assert.equal(cleanRef("11111111111111111111111111111111"), "11111111111111111111111111111111");
  for (const v of [undefined, null, 7, "", "short", "0".repeat(44), "O".repeat(44), "l".repeat(44), "A".repeat(45), [A], { A }]) {
    assert.equal(cleanRef(v), null, String(v));
  }
});

test("withRef: noted per presale, the newest link wins, junk changes nothing", () => {
  const one = withRef({}, P, A, 1);
  assert.deepEqual(one, { [P]: { ref: A, at: 1 } });
  assert.deepEqual(withRef(one, P, B, 2), { [P]: { ref: B, at: 2 } }, "a newer link from someone else");
  assert.equal(withRef(one, P, A, 3), one, "the same ref again: nothing to save");
  assert.equal(withRef(one, P, "nope", 3), one);
  assert.equal(withRef(one, "nope", A, 3), one);
  assert.deepEqual(withRef(undefined, P, A, 1), { [P]: { ref: A, at: 1 } }, "nothing saved yet");
  assert.deepEqual(withRef("junk", P, A, 1), { [P]: { ref: A, at: 1 } }, "a broken save");
});

test("withRef: keeps the newest MAX_REFS presales", () => {
  let refs = {};
  const keys = [..."abcdefghijkm"].map((c) => c.repeat(44)); // base58 letters only
  assert.equal(keys.length, MAX_REFS + 2);
  keys.forEach((k, i) => (refs = withRef(refs, k, A, i)));
  assert.equal(Object.keys(refs).length, MAX_REFS);
  assert.ok(!(keys[0] in refs) && !(keys[1] in refs), "the two oldest went");
  assert.ok(keys.at(-1) in refs);
});

test("refFor: the kept ref, never the joiner's own wallet", () => {
  const refs = { [P]: { ref: A, at: 1 } };
  assert.equal(refFor(refs, P, B), A);
  assert.equal(refFor(refs, P, A), null, "no one refers themselves");
  assert.equal(refFor(refs, Q, B), null, "another presale");
  assert.equal(refFor({ [P]: { ref: "bad", at: 1 } }, P, B), null);
  assert.equal(refFor(undefined, P, B), null);
});

test("withoutRef: drops one presale's ref", () => {
  const refs = { [P]: { ref: A, at: 1 }, [Q]: { ref: B, at: 2 } };
  assert.deepEqual(withoutRef(refs, P), { [Q]: { ref: B, at: 2 } });
  assert.equal(withoutRef(refs, "other"), refs);
  assert.equal(withoutRef(undefined, P), undefined);
});

test("shareLink: the presale's link, with ?ref= only for a real wallet", () => {
  assert.equal(shareLink("https://app.mooner.family", P, A), `https://app.mooner.family/presale/${P}?ref=${A}`);
  assert.equal(shareLink("https://app.mooner.family", P, null), `https://app.mooner.family/presale/${P}`);
  assert.equal(shareLink("", P, "guest"), `/presale/${P}`, "the web's signed-out user");
});
