// Mooner pictures: cache file names, and the queue in front of the page that draws them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePfpCache, pfpKey } from "../src/pfp/cache.js";

const W = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const PFP = { skin: "moon", eyes: "stars", mouth: "grin", head: "none", face: "none", outfit: "tee", neck: "none", aura: "none", bg: "night" };
const PNG = "data:image/png;base64,";

test("the same picture gets the same name, a short png file name", () => {
  const name = pfpKey(W, PFP, 128);
  assert.match(name, /^pfp-[0-9a-f]{24}\.png$/);
  assert.equal(pfpKey(W, { ...PFP }, 128), name);
});

test("a changed trait, wallet or size gets a different name", () => {
  const name = pfpKey(W, PFP, 128);
  assert.notEqual(pfpKey(W, { ...PFP, eyes: "laser" }, 128), name);
  assert.notEqual(pfpKey("Other111", PFP, 128), name);
  assert.notEqual(pfpKey(W, PFP, 256), name);
});

test("the order of the traits doesn't matter", () => {
  const reversed = Object.fromEntries(Object.entries(PFP).reverse());
  assert.equal(pfpKey(W, reversed, 128), pfpKey(W, PFP, 128));
  assert.equal(pfpKey(W, { b: { y: 1, x: 2 }, a: 1 }, 128), pfpKey(W, { a: 1, b: { x: 2, y: 1 } }, 128));
});

test("no saved picture (the default) has one stable name, apart from any traits", () => {
  assert.equal(pfpKey(W, null, 128), pfpKey(W, null, 128));
  assert.equal(pfpKey(W, undefined, 128), pfpKey(W, null, 128));
  assert.notEqual(pfpKey(W, null, 128), pfpKey(W, PFP, 128));
});

/** A cache over a fake folder and page: `sent` holds what was posted, `answer()` replies;
 *  writes throw while `full.on`. */
function rig(onDisk = []) {
  const disk = new Map(onDisk.map((n) => [n, "x"]));
  const full = { on: false };
  const files = {
    uri: (name) => `file:///cache/${name}`,
    exists: (name) => disk.has(name),
    write(name, base64) {
      if (full.on) throw new Error("disk full");
      disk.set(name, base64);
    },
  };
  const cache = makePfpCache({ files, readyMs: 1_000, drawMs: 2_000 });
  const sent = [];
  let downs = 0;
  const open = () => cache.open((text) => sent.push(JSON.parse(text)), () => downs++);
  const answer = (msg) => cache.message(JSON.stringify(msg));
  return { cache, disk, full, sent, open, answer, downs: () => downs };
}

const settled = (p) => p.then((uri) => ({ uri }), (e) => ({ error: e.message }));
const flush = () => new Promise((r) => setImmediate(r));

test("a picture on disk resolves at once and nothing is sent", async () => {
  const name = pfpKey(W, PFP, 128);
  const r = rig([name]);
  r.open();
  assert.equal(r.cache.cached(name), `file:///cache/${name}`);
  assert.equal(await r.cache.request(W, PFP, 128), `file:///cache/${name}`);
  r.answer({ ready: true });
  assert.deepEqual(r.sent, []);
});

test("asks wait for the page to say ready, go one at a time, and land on disk", async () => {
  const r = rig();
  r.open();
  const a = r.cache.request(W, PFP, 128);
  const b = r.cache.request(W, null, 256);
  assert.equal(r.cache.request(W, PFP, 128), a, "asking again gives the same promise");
  assert.deepEqual(r.sent, []);
  r.answer({ ready: true });
  assert.deepEqual(r.sent, [{ id: "1", wallet: W, pfp: PFP, px: 128 }]);
  r.answer({ id: "1", png: `${PNG}AAAA` });
  const name = pfpKey(W, PFP, 128);
  assert.equal(await a, `file:///cache/${name}`);
  assert.equal(r.disk.get(name), "AAAA");
  assert.equal(r.cache.cached(name), `file:///cache/${name}`);
  assert.deepEqual(r.sent[1], { id: "2", wallet: W, pfp: null, px: 256 });
  r.answer({ id: "2", png: `${PNG}BBBB` });
  assert.equal(await b, `file:///cache/${pfpKey(W, null, 256)}`);
});

test("a picture the page couldn't draw fails once, and the next one is drawn", async () => {
  const r = rig();
  r.open();
  r.answer({ ready: true });
  const a = r.cache.request(W, PFP, 128);
  const b = r.cache.request(W, null, 128);
  r.answer({ id: "1", error: "Could not draw the picture" });
  assert.deepEqual(await settled(a), { error: "Could not draw the picture" });
  assert.equal(r.cache.request(W, PFP, 128), a, "no second try this run");
  assert.equal(r.sent.length, 2);
  r.answer({ id: "1", png: `${PNG}AAAA` }); // a stray answer to an old id changes nothing
  r.answer({ id: "2", png: "data:text/html;base64,AAAA" });
  assert.deepEqual(await settled(b), { error: "the page sent no picture" });
  assert.equal(r.disk.size, 0);
});

test("a page that never says ready fails everything waiting, and later asks too", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig();
  r.open();
  const a = r.cache.request(W, PFP, 128);
  t.mock.timers.tick(999);
  await flush();
  assert.equal(r.downs(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await settled(a), { error: "the picture page didn't load" });
  assert.equal(r.downs(), 1);
  assert.deepEqual(await settled(r.cache.request(W, null, 128)), { error: "the picture page didn't load" });
  assert.deepEqual(r.sent, []);
});

test("a load or HTTP error takes the page down", async () => {
  const r = rig();
  r.open();
  const a = r.cache.request(W, PFP, 128);
  r.cache.fail(new Error("HTTP 404"));
  r.cache.fail(new Error("again")); // only the first counts
  assert.deepEqual(await settled(a), { error: "HTTP 404" });
  assert.equal(r.downs(), 1);
  r.answer({ ready: true });
  assert.deepEqual(r.sent, []);
  let reopened = 0;
  r.cache.open(() => {}, () => reopened++);
  assert.equal(reopened, 1, "a page opened after it went down is told at once");
});

test("a picture that takes too long takes the page down", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig();
  r.open();
  r.answer({ ready: true });
  const a = r.cache.request(W, PFP, 128);
  const b = r.cache.request(W, null, 128);
  t.mock.timers.tick(2_000);
  assert.deepEqual(await settled(a), { error: "a picture took too long to draw" });
  assert.deepEqual(await settled(b), { error: "a picture took too long to draw" });
  assert.equal(r.sent.length, 1);
});

test("a WebView unmounted mid-draw hands the picture to the next one", async () => {
  const r = rig();
  r.open();
  r.answer({ ready: true });
  const a = r.cache.request(W, PFP, 128);
  r.cache.close();
  r.answer({ id: "1", png: `${PNG}AAAA` }); // nothing is open: ignored
  r.open();
  r.answer({ ready: true });
  assert.deepEqual(r.sent.map((m) => m.id), ["1", "2"]);
  r.answer({ id: "2", png: `${PNG}AAAA` });
  assert.equal(await a, `file:///cache/${pfpKey(W, PFP, 128)}`);
});

test("a write that fails rejects that picture only", async () => {
  const r = rig();
  r.open();
  r.answer({ ready: true });
  const a = r.cache.request(W, PFP, 128);
  const b = r.cache.request(W, null, 128);
  r.full.on = true;
  r.answer({ id: "1", png: `${PNG}AAAA` });
  assert.deepEqual(await settled(a), { error: "disk full" });
  r.full.on = false;
  r.answer({ id: "2", png: `${PNG}BBBB` });
  assert.equal(await b, `file:///cache/${pfpKey(W, null, 128)}`);
});
