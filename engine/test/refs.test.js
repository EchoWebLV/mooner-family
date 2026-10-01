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

test("withRef: the viewer's own link never replaces a friend's ref", () => {
  const friend = withRef({}, P, A, 1, B);
  assert.deepEqual(friend, { [P]: { ref: A, at: 1 } });
  assert.equal(withRef(friend, P, B, 2, B), friend, "my own link: the friend's ref stays");
  assert.equal(withRef(friend, P, ` ${B}\n`, 2, ` ${B}`), friend, "padded, still mine");
  const none = {};
  assert.equal(withRef(none, P, B, 1, B), none, "my own link and nothing kept");
  assert.deepEqual(withRef(friend, P, B, 2, null), { [P]: { ref: B, at: 2 } }, "viewer unknown: the newest link wins");
  assert.deepEqual(withRef(friend, P, B, 2), { [P]: { ref: B, at: 2 } }, "viewer unknown (undefined)");
});

test("withRef: junk in a saved map never blocks a new ref, and the write drops it", () => {
  const keys = [..."abcdefghijkmnopqrstuvwxyz"].map((c) => c.repeat(44)); // base58 letters only
  const junk = {
    [keys[0]]: "junk", // string values
    [keys[1]]: A,
    [keys[2]]: [A], // array values
    [keys[3]]: [{ ref: A, at: 9e15 }],
    "not a presale": { ref: A, at: 9e15 }, // a bad key
    ["0".repeat(44)]: { ref: A, at: 9e15 },
    [keys[4]]: { ref: "bad", at: 9e15 }, // a bad ref
  };
  // A fine presale and ref but no usable `at` (missing, or not a number): it counts as oldest.
  const odd = [{ ref: A }, { ref: A, at: "9e15" }, { ref: A, at: null }, { ref: A, at: "x" }];
  const saved = { ...junk };
  keys.slice(5, 5 + MAX_REFS).forEach((k, i) => (saved[k] = odd[i % odd.length]));
  assert.equal(Object.keys(saved).length, MAX_REFS + Object.keys(junk).length);
  const next = withRef(saved, P, B, 1);
  assert.deepEqual(next[P], { ref: B, at: 1 }, "the new presale is kept");
  assert.equal(Object.keys(next).length, MAX_REFS);
  for (const k of Object.keys(junk)) assert.ok(!(k in next), `junk ${k} is gone`);
  for (const [k, v] of Object.entries(next)) assert.ok(cleanRef(k) && cleanRef(v.ref), k);
});

test("withRef: a note older than every kept one (the clock went back) changes nothing", () => {
  let refs = {};
  const keys = [..."abcdefghijkm"].map((c) => c.repeat(44)).slice(0, MAX_REFS);
  keys.forEach((k, i) => (refs = withRef(refs, k, A, 100 + i)));
  assert.equal(Object.keys(refs).length, MAX_REFS);
  assert.equal(withRef(refs, P, B, 5), refs, "cut at once: nothing to save");
});

test("cleanRef: 31 characters is too short", () => {
  assert.equal(cleanRef("1".repeat(31)), null);
  assert.equal(cleanRef("1".repeat(32)), "1".repeat(32));
});

test("shareLink: a trailing / on the base, and a key that can't move the real ?ref=", () => {
  assert.equal(shareLink("https://app.mooner.family/", P, A), `https://app.mooner.family/presale/${P}?ref=${A}`);
  assert.equal(shareLink("https://app.mooner.family//", P, null), `https://app.mooner.family/presale/${P}`);
  const key = `x?ref=${B}#`;
  const link = shareLink("https://app.mooner.family", key, A);
  assert.equal(link, `https://app.mooner.family/presale/${encodeURIComponent(key)}?ref=${A}`);
  const url = new URL(link);
  assert.equal(url.searchParams.get("ref"), A);
  assert.equal(decodeURIComponent(url.pathname), `/presale/${key}`);
  assert.equal(url.hash, "");
});

test("refFor: a padded wallet is still the joiner's own", () => {
  assert.equal(refFor({ [P]: { ref: A, at: 1 } }, P, ` ${A}`), null);
});

test("withRef: a string `at` never outranks a number one", () => {
  const saved = {};
  [..."abcdefghijkm"].slice(0, MAX_REFS).forEach((c) => (saved[c.repeat(44)] = { ref: A, at: "9e15" }));
  assert.deepEqual(withRef(saved, P, B, 1)[P], { ref: B, at: 1 });
});

test("withRef: padded keys and refs don't survive a write", () => {
  assert.deepEqual(withRef({}, ` ${P}`, A, 1), { [P]: { ref: A, at: 1 } }, "a padded presale");
  assert.deepEqual(withRef({ [` ${Q}`]: { ref: A, at: 5 } }, P, B, 1), { [P]: { ref: B, at: 1 } }, "a saved padded key");
  assert.deepEqual(
    withRef({ [Q]: { ref: ` ${A}\n`, at: 5 } }, P, B, 1),
    { [P]: { ref: B, at: 1 }, [Q]: { ref: A, at: 5 } },
    "a saved padded ref",
  );
});

test("shareLink: never throws, even on a lone surrogate in the key", () => {
  assert.equal(shareLink("", "\uD800", null), "/presale/%EF%BF%BD");
  assert.equal(shareLink("", "\uDC00x😀y\uD83D", A), `/presale/%EF%BF%BDx%F0%9F%98%80y%EF%BF%BD?ref=${A}`);
});
