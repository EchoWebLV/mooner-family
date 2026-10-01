// The site (web/) and the sim (web/sim/) show and check presale amounts with their own copies
// of the numbers, and web has no test runner, so this checks them here: they must be the
// program's mainnet numbers (consts.js MAINNET, which upgrade.test.js ties to consts.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { numbers } from "../src/consts.js";

const FILES = ["web/src/lib/constants.ts", "web/sim/src/lib/constants.ts"];
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

// web name -> consts.js name
const SAME = { PRESALE_TARGET: "TARGET", MIN_COMMIT: "MIN_SEAT", MAX_COMMIT: "MAX_SEAT", COMMIT_STEP: "STEP" };

/** What in a constants.ts differs from N. The creator cap is worked out from the file's own
 *  expression and must be what the co-signer and the program allow: min(MAX_SEAT, TARGET - MIN_SEAT). */
function webDiffers(src, N) {
  const out = [];
  const vals = {};
  for (const [web, eng] of Object.entries(SAME)) {
    const m = src.match(new RegExp(`^export const ${web} = ([0-9_]+)$`, "m"));
    if (!m) { out.push(`${web} is missing or not a plain number`); continue; }
    vals[web] = BigInt(m[1].replaceAll("_", ""));
    if (vals[web] !== N[eng]) out.push(`${web} is ${vals[web]}, ${eng} is ${N[eng]}`);
  }
  const want = N.MAX_SEAT < N.TARGET - N.MIN_SEAT ? N.MAX_SEAT : N.TARGET - N.MIN_SEAT;
  const cap = src.match(/^export const MAX_CREATOR_COMMIT = (.+)$/m);
  if (!cap) {
    out.push("MAX_CREATOR_COMMIT is missing");
  } else {
    let got;
    try {
      const names = Object.keys(vals);
      got = BigInt(new Function(...names, `return ${cap[1]}`)(...names.map((n) => Number(vals[n]))));
    } catch (e) {
      got = `unreadable (${e.message})`;
    }
    if (got !== want) out.push(`MAX_CREATOR_COMMIT is ${got}, the co-signer allows ${want}`);
  }
  return out;
}

for (const f of FILES) {
  test(`${f} has the program's mainnet numbers`, () => {
    assert.deepEqual(webDiffers(read(f), numbers(false)), []);
  });
}

test("the check sees any one number that differs", () => {
  const src = read(FILES[0]);
  const N = numbers(false);
  const changed = {
    PRESALE_TARGET: [/^export const PRESALE_TARGET = .+$/m, "export const PRESALE_TARGET = 10_000_000_000"],
    MIN_COMMIT: [/^export const MIN_COMMIT = .+$/m, "export const MIN_COMMIT = 50_000_000"],
    MAX_COMMIT: [/^export const MAX_COMMIT = .+$/m, "export const MAX_COMMIT = 1_000_000_000"],
    COMMIT_STEP: [/^export const COMMIT_STEP = .+$/m, "export const COMMIT_STEP = 1_000_000"],
    MAX_CREATOR_COMMIT: [/^export const MAX_CREATOR_COMMIT = .+$/m, "export const MAX_CREATOR_COMMIT = PRESALE_TARGET - COMMIT_STEP"],
  };
  for (const [name, [re, line]] of Object.entries(changed)) {
    assert.match(src, re, `${name} is in the file`);
    const off = webDiffers(src.replace(re, line), N);
    assert.ok(off.length >= 1 && off.some((o) => o.startsWith(name)), `${name}: ${off}`);
  }
  // a number the program changes is seen too, and the creator cap moves with it
  assert.deepEqual(webDiffers(src, { ...N, TARGET: 400_000_000n }), [
    "PRESALE_TARGET is 500000000, TARGET is 400000000",
    "MAX_CREATOR_COMMIT is 400000000, the co-signer allows 300000000",
  ]);
  assert.deepEqual(webDiffers(src.replace(/^export const MAX_COMMIT = .+$/m, "export const MAX_COMMIT = 300_000_000"), { ...N, MAX_SEAT: 300_000_000n }), [],
    "MAX_SEAT below TARGET - MIN_SEAT caps the creator at MAX_SEAT");
  assert.deepEqual(webDiffers("", N).length, 5, "a file without them");
});
