// Link X's way back (src/xp/xlink.js): what the link the server sends the browser to says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { X_BACK, isXBack, xBackOf } from "../src/xp/xlink.js";

test("xBackOf: the handle, or the server's words with %20 or +; anything else says nothing", () => {
  assert.deepEqual(xBackOf(`${X_BACK}?handle=moonboi`), { handle: "moonboi" });
  assert.deepEqual(xBackOf(`${X_BACK}?error=That%20sign-in%20ran%20out.%20Tap%20Link%20X%20again.`), { error: "That sign-in ran out. Tap Link X again." });
  assert.deepEqual(xBackOf(`${X_BACK}?error=X+said+no.`), { error: "X said no." });
  assert.equal(xBackOf(X_BACK), null);
  assert.equal(xBackOf(`${X_BACK}?error=%E0%A4%A`), null, "a bad escape");
  assert.equal(xBackOf("mooner://presale/K?handle=x"), null);
  assert.equal(xBackOf("mooner://x-linkage?handle=x"), null);
  assert.equal(xBackOf(null), null);
});

test("isXBack: only the way back", () => {
  assert.equal(isXBack("mooner://x-link?handle=a"), true);
  assert.equal(isXBack("mooner://x-link"), true);
  assert.equal(isXBack("mooner://x-links"), false);
  assert.equal(isXBack("/me"), false);
});
