// What a wallet client signs: the texts the server checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/client.js";
import * as social from "../server/social.js";

test("the sign-in text is the one the server checks", () => {
  assert.equal(C.loginMessage("W1", 1700000000), "Mooner: sign in\nwallet: W1\ntime: 1700000000");
  assert.equal(social.loginMessage, C.loginMessage);
});
