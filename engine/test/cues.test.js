// The cue table, and the sounds, emojis, scenes and host both apps ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { CHAT_SOUND_GAP_MS, CUES, FLOAT_GAP_MS, FLOAT_MAX, QUIET_ON_PULSE, SHEET_CLOSE, allowedOn, chatGate } from "../src/cues.js";
import { EMOJI } from "../src/emoji.js";

const APPS = ["../../mobile/assets/", "../../web/public/"];
const filesIn = (dir) => new Set(readdirSync(new URL(dir, import.meta.url)));

test("16 cues, each with a volume above 0 and at most 1", () => {
  assert.equal(Object.keys(CUES).length, 16);
  for (const [cue, v] of Object.entries(CUES)) assert.ok(v > 0 && v <= 1, cue);
  assert.equal(CUES.tap, 0.5);
  assert.equal(CUES.tick, 0.3);
  assert.equal(CUES.stamp, 0.75);
});

test("every cue has its sound in both apps", () => {
  for (const app of APPS) {
    const have = filesIn(`${app}sfx/`);
    for (const cue of Object.keys(CUES)) assert.ok(have.has(`${cue}.mp3`), `${app}sfx/${cue}.mp3`);
  }
});

test("every emoji has its picture in both apps", () => {
  for (const app of APPS) {
    const have = filesIn(`${app}emoji/`);
    for (const name of EMOJI) assert.ok(have.has(`${name}.png`), `${app}emoji/${name}.png`);
  }
});

test("the three scenes and the host are in both apps", () => {
  for (const app of APPS) {
    const scenes = filesIn(`${app}scenes/`);
    for (const s of ["room", "launching", "live"]) assert.ok(scenes.has(`${s}.jpg`), `${app}scenes/${s}.jpg`);
    assert.ok(filesIn(app).has("host.png"), `${app}host.png`);
  }
});

test("Pulse plays only tap", () => {
  assert.deepEqual(QUIET_ON_PULSE, ["tap"]);
  assert.equal(allowedOn("tap", "pulse"), true);
  assert.equal(allowedOn("chat", "pulse"), false);
  assert.equal(allowedOn("chat", "room"), true);
});

test("chatGate: at most one chat sound every 400 ms", () => {
  assert.equal(CHAT_SOUND_GAP_MS, 400);
  const gate = chatGate();
  assert.equal(gate(1000), true);
  assert.equal(gate(1399), false);
  assert.equal(gate(1400), true);
  assert.equal(gate(1500), false);
});

test("a closing sheet plays faster and lower; floats are 4 at most, 260 ms apart", () => {
  assert.deepEqual(SHEET_CLOSE, { rate: 1.15, volume: 0.8 });
  assert.equal(FLOAT_MAX, 4);
  assert.equal(FLOAT_GAP_MS, 260);
});
