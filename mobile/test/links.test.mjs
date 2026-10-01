// A coin's links as the screens offer them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linksOf } from "../src/ui/links.js";

test("linksOf: the https links that are there", () => {
  assert.deepEqual(linksOf(null), []);
  assert.deepEqual(linksOf({ links: { twitter: "https://x.com/m", telegram: "", website: "https://m.fun " } }), [
    { label: "X", url: "https://x.com/m" },
    { label: "Website", url: "https://m.fun" },
  ]);
  assert.deepEqual(linksOf({ links: { twitter: "javascript:alert(1)", telegram: "http://t.me/m", website: "intent://x" } }), []);
});
