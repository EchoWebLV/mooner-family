// Which cue a move between screens plays: the room whooshes, any other screen taps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenCue } from "../src/ui/screens.js";

test("screenCue: whoosh into a room, tap anywhere else, nothing on the first screen", () => {
  assert.equal(screenCue(null, "/"), null);
  assert.equal(screenCue("/", "/"), null);
  assert.equal(screenCue("/", "/presale/K"), "whoosh");
  assert.equal(screenCue("/presale/K", "/coin/K"), "tap");
  assert.equal(screenCue("/coin/K", "/"), "tap");
  assert.equal(screenCue("/", "/me"), "tap");
});
