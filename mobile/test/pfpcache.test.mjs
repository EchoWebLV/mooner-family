// Mooner pictures: cache file names, the folders they are kept in, and the queue in front of
// the page that draws them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePfpCache, pfpKey } from "../src/pfp/cache.js";

const W = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const V = "W2222222222222222222222222222222222222222222";
const PFP = { skin: "moon", eyes: "stars", mouth: "grin", head: "none", face: "none", outfit: "tee", neck: "none", aura: "none", bg: "night" };
const PNG = "data:image/png;base64,";
const ORIGIN = "https://app.mooner.family";
/** Where picture `name` drawn by renderer `v` is kept in the cache folder. */
const at = (name, v = "17") => `pfp-v${v}/${name}`;

test("the same picture gets the same name, a short png file name", () => {
  const name = pfpKey(W, PFP, 128, "17");
  assert.match(name, /^pfp-[0-9a-f]{24}\.png$/);
  assert.equal(pfpKey(W, { ...PFP }, 128, "17"), name);
});

test("a changed trait, wallet, size or renderer version gets a different name", () => {
  const name = pfpKey(W, PFP, 128, "17");
  assert.notEqual(pfpKey(W, { ...PFP, eyes: "laser" }, 128, "17"), name);
  assert.notEqual(pfpKey(V, PFP, 128, "17"), name);
  assert.notEqual(pfpKey(W, PFP, 256, "17"), name);
  assert.notEqual(pfpKey(W, PFP, 128, "18"), name);
  assert.notEqual(pfpKey(W, PFP, 128, null), name);
});

test("the order of the traits doesn't matter", () => {
  const reversed = Object.fromEntries(Object.entries(PFP).reverse());
  assert.equal(pfpKey(W, reversed, 128, "17"), pfpKey(W, PFP, 128, "17"));
  assert.equal(pfpKey(W, { b: { y: 1, x: 2 }, a: 1 }, 128), pfpKey(W, { a: 1, b: { x: 2, y: 1 } }, 128));
});

test("no saved picture (the default) has one stable name, apart from any traits", () => {
  assert.equal(pfpKey(W, null, 128, "17"), pfpKey(W, null, 128, "17"));
  assert.equal(pfpKey(W, undefined, 128, undefined), pfpKey(W, null, 128, null));
  assert.notEqual(pfpKey(W, null, 128, "17"), pfpKey(W, PFP, 128, "17"));
});

/**
 * A cache over a fake cache folder and page. `disk` maps file paths to contents, `dirs` holds
 * the folders; the folder of renderer `version` is there at the start (null: none). `sent`
 * holds what was posted, `answer(msg)` replies from the page's origin, `got` collects the uris
 * handed out. Writes throw while `full.on`. console.warn is caught in `warned`.
 */
function rig(t, { onDisk = [], version = "17", ...opts } = {}) {
  const warned = [];
  t.mock.method(console, "warn", (...args) => warned.push(args.join(" ")));
  const disk = new Map(onDisk.map((p) => [p, "x"]));
  const dirs = new Set([...(version ? [`pfp-v${version}`] : []), ...onDisk.filter((p) => p.includes("/")).map((p) => p.split("/")[0])]);
  const full = { on: false };
  const ops = [];
  const files = {
    uri: (path) => `file:///cache/${path}`,
    exists: (path) => disk.has(path),
    list: (path) =>
      path
        ? [...disk.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1))
        : [...dirs, ...[...disk.keys()].filter((p) => !p.includes("/"))],
    write(path, base64) {
      if (full.on) throw new Error("disk full");
      ops.push(`write ${path}`);
      if (path.includes("/")) dirs.add(path.split("/")[0]);
      disk.set(path, base64);
    },
    rename(from, to) {
      ops.push(`rename ${from} ${to}`);
      disk.set(to, disk.get(from));
      disk.delete(from);
    },
    remove(path) {
      dirs.delete(path);
      for (const p of disk.keys()) if (p === path || p.startsWith(`${path}/`)) disk.delete(p);
    },
  };
  const cache = makePfpCache({ files, origin: ORIGIN, readyMs: 1_000, drawMs: 2_000, idleMs: 60_000, ...opts });
  const sent = [];
  const got = [];
  let changes = 0;
  cache.subscribe(() => changes++);
  const open = () => cache.open((text) => sent.push(JSON.parse(text)));
  const answer = (msg, from = `${ORIGIN}/pfp.html`) => cache.message(JSON.stringify(msg), from);
  const want = (wallet, pfp, px) => cache.want(wallet, pfp, px, (uri) => got.push(uri));
  const uri = (wallet, pfp, px, v = cache.version()) => `file:///cache/${at(pfpKey(wallet, pfp, px, v), v)}`;
  return { cache, disk, dirs, full, ops, sent, got, warned, open, answer, want, uri, changes: () => changes };
}

test("messages count only from the page's origin or its URL", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  r.open();
  r.answer({ ready: true, version: "17" }, "https://evil.example");
  r.answer({ ready: true, version: "17" }, "https://app.mooner.family.evil.example");
  r.answer({ ready: true, version: "17" }, null);
  assert.deepEqual(r.sent, []);
  r.answer({ ready: true, version: "17" }, ORIGIN); // WebMessageListener: the bare origin
  assert.equal(r.sent.length, 1);
  r.answer({ id: "1", png: `${PNG}AAAA` }, "https://evil.example");
  assert.deepEqual(r.got, []);
  r.answer({ id: "1", png: `${PNG}AAAA` }, `${ORIGIN}/pfp.html`); // older WebViews: the page's URL
  assert.deepEqual(r.got, [r.uri(W, PFP, 128)]);
});

test("a picture on disk is handed out at once, and no page is wanted", (t) => {
  const r = rig(t, { onDisk: [at(pfpKey(W, PFP, 128, "17"))] });
  assert.equal(r.cache.cached(pfpKey(W, PFP, 128, "17")), r.uri(W, PFP, 128));
  r.want(W, PFP, 128);
  assert.deepEqual(r.got, [r.uri(W, PFP, 128)]);
  assert.equal(r.cache.wanted(), false);
  assert.equal(r.changes(), 0);
});

test("a missing picture wants the page; asks wait for ready, go one at a time, and land whole on disk", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  assert.equal(r.cache.wanted(), true);
  assert.equal(r.changes(), 1);
  r.want(W, PFP, 128); // a second face, the same picture: one job
  r.want(W, null, 256);
  r.open();
  assert.deepEqual(r.sent, []);
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent, [{ id: "1", wallet: W, pfp: PFP, px: 128 }]);
  r.answer({ id: "1", png: `${PNG}AAAA` });
  const path = at(pfpKey(W, PFP, 128, "17"));
  assert.deepEqual(r.ops, [`write ${path}.part`, `rename ${path}.part ${path}`]);
  assert.equal(r.disk.get(path), "AAAA");
  assert.deepEqual(r.got, [r.uri(W, PFP, 128), r.uri(W, PFP, 128)]);
  assert.deepEqual(r.sent[1], { id: "2", wallet: W, pfp: null, px: 256 });
  r.answer({ id: "2", png: `${PNG}BBBB` });
  assert.equal(r.got[2], r.uri(W, null, 256));
  assert.equal(r.changes(), 1, "the same version: no rename");
});

test("a picture the page couldn't draw is logged, tried once this run, and the next one is drawn", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  r.want(W, null, 128);
  r.want(V, null, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  r.answer({ id: "1", error: "WebGL context lost" });
  assert.deepEqual(r.warned, ["pfp: WebGL context lost"]);
  r.want(W, PFP, 128);
  assert.equal(r.sent.length, 2, "no second try");
  r.answer({ id: "1", png: `${PNG}AAAA` }); // a stray answer to an old id changes nothing
  r.answer({ id: "2", png: "data:text/html;base64,AAAA" });
  r.answer({ id: "3", png: PNG + "A".repeat(2_000_000) });
  assert.deepEqual(r.warned.slice(1), ["pfp: the page sent no picture", "pfp: the page sent a picture too big to keep"]);
  assert.deepEqual(r.got, []);
  assert.equal(r.disk.size, 0);
});

test("a picture nobody waits for any more is dropped unless it is being drawn", (t) => {
  const r = rig(t);
  const offDefault = r.want(W, null, 128); // before the profiles arrive: the default
  const offOther = r.want(V, null, 128);
  const offTwice = r.want(V, null, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent.map((m) => m.wallet), [W]);
  offDefault(); // being drawn: it finishes
  offOther(); // another face still waits for it
  r.want(W, PFP, 128); // the saved picture arrived
  const offLate = r.want(V, PFP, 256);
  offLate(); // queued, nobody waits: dropped
  r.answer({ id: "1", png: `${PNG}AAAA` });
  assert.equal(r.disk.has(at(pfpKey(W, null, 128, "17"))), true);
  assert.deepEqual(r.sent.map((m) => [m.wallet, m.px]), [[W, 128], [V, 128]]);
  r.answer({ id: "2", png: `${PNG}BBBB` });
  assert.deepEqual(r.sent.map((m) => [m.wallet, m.pfp && "saved"]), [[W, null], [V, null], [W, "saved"]]);
  offTwice();
});

test("the page is let go after a minute with nothing to draw", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(t);
  r.want(W, PFP, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  r.answer({ id: "1", png: `${PNG}AAAA` });
  t.mock.timers.tick(59_999);
  assert.equal(r.cache.wanted(), true);
  r.want(V, null, 128); // more came: it stays
  t.mock.timers.tick(1);
  assert.equal(r.cache.wanted(), true);
  r.answer({ id: "2", png: `${PNG}BBBB` });
  t.mock.timers.tick(60_000);
  assert.equal(r.cache.wanted(), false);
  r.cache.close(); // PfpRenderer unmounts the WebView
  r.want(W, null, 512);
  assert.equal(r.cache.wanted(), true, "a missing picture wants it again");
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent.at(-1), { id: "3", wallet: W, pfp: null, px: 512 });
});

test("a new renderer version renames waiting pictures and deletes the old version's folder", (t) => {
  const old = pfpKey(W, PFP, 128, "16");
  const r = rig(t, { onDisk: [at(old, "16")], version: "16" });
  assert.equal(r.cache.version(), "16", "the folder on disk gives the version");
  assert.equal(r.cache.cached(old), `file:///cache/${at(old, "16")}`);
  r.want(W, null, 128);
  r.open();
  r.answer({ ready: true, version: 17 });
  assert.equal(r.cache.version(), "17");
  assert.equal(r.changes(), 2, "wanted, then the version");
  assert.deepEqual([...r.dirs], [], "the 16 folder is gone");
  assert.equal(r.disk.size, 0);
  assert.deepEqual(r.sent, [{ id: "1", wallet: W, pfp: null, px: 128 }]);
  r.answer({ id: "1", png: `${PNG}AAAA` });
  assert.equal(r.disk.has(at(pfpKey(W, null, 128, "17"))), true);
  assert.deepEqual(r.got, [r.uri(W, null, 128, "17")]);
  r.want(W, PFP, 128); // its 16 picture is gone: drawn again
  assert.equal(r.sent.at(-1).wallet, W);
  assert.equal(r.sent.length, 2);
});

test("with several version folders the version is heard from the page; one already drawn is used", (t) => {
  const done = at(pfpKey(V, null, 128, "17"));
  const r = rig(t, { onDisk: [at(pfpKey(V, null, 128, "16"), "16"), done], version: null });
  assert.equal(r.cache.version(), null);
  assert.equal(r.cache.cached(pfpKey(V, null, 128, "17")), null, "nothing is read before the version is known");
  r.want(V, null, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.got, [`file:///cache/${done}`]);
  assert.deepEqual(r.sent, []);
  assert.deepEqual([...r.dirs], ["pfp-v17"]);
});

test("a page that says no version counts as version 0", (t) => {
  const r = rig(t, { version: null });
  r.want(W, null, 128);
  r.open();
  r.answer({ ready: true });
  assert.equal(r.cache.version(), "0");
  r.answer({ id: "1", png: `${PNG}AAAA` });
  assert.deepEqual(r.got, [`file:///cache/${at(pfpKey(W, null, 128, "0"), "0")}`]);
});

test("a page that never says ready is down: logged, the WebView let go, later asks ignored", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(t);
  r.want(W, PFP, 128);
  r.open();
  t.mock.timers.tick(999);
  assert.equal(r.cache.wanted(), true);
  t.mock.timers.tick(1);
  assert.equal(r.cache.wanted(), false);
  assert.deepEqual(r.warned, ["pfp page down: the picture page didn't load"]);
  r.want(W, null, 128);
  r.cache.check();
  assert.equal(r.cache.wanted(), false, "no version check once down");
  r.cache.open(() => assert.fail("no page once down"));
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.got, []);
});

test("a load or HTTP error takes the page down once", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  r.open();
  r.cache.fail(new Error("the picture page answered HTTP 404"));
  r.cache.fail(new Error("again"));
  assert.deepEqual(r.warned, ["pfp page down: the picture page answered HTTP 404"]);
  assert.equal(r.cache.wanted(), false);
});

test("a picture that takes too long takes the page down", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(t);
  r.want(W, PFP, 128);
  r.want(W, null, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  t.mock.timers.tick(2_000);
  assert.equal(r.cache.wanted(), false);
  assert.deepEqual(r.warned, ["pfp page down: a picture took too long to draw"]);
  assert.equal(r.sent.length, 1);
});

test("Android stopping the page once mounts it again; a crash or a second stop takes it down", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.equal(r.cache.gone(false), true);
  r.open(); // the new WebView
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent.map((m) => m.id), ["1", "2"], "the picture is asked of the new page");
  r.answer({ id: "2", png: `${PNG}AAAA` });
  assert.deepEqual(r.got, [r.uri(W, PFP, 128)]);
  assert.equal(r.cache.gone(false), false);
  assert.equal(r.cache.wanted(), false);

  const c = rig(t);
  c.want(W, PFP, 128);
  c.open();
  assert.equal(c.cache.gone(true), false);
  assert.deepEqual(c.warned.at(-1), "pfp page down: the picture page crashed");
});

test("a WebView unmounted mid-draw hands the picture to the next one", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  r.cache.close();
  r.answer({ id: "1", png: `${PNG}AAAA` }); // nothing is open: ignored
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent.map((m) => m.id), ["1", "2"]);
  r.answer({ id: "2", png: `${PNG}AAAA` });
  assert.deepEqual(r.got, [r.uri(W, PFP, 128)]);
});

test("a write that fails fails that picture only", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  r.want(W, null, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  r.full.on = true;
  r.answer({ id: "1", png: `${PNG}AAAA` });
  assert.deepEqual(r.warned, ["pfp: disk full"]);
  r.full.on = false;
  r.answer({ id: "2", png: `${PNG}BBBB` });
  assert.deepEqual(r.got, [r.uri(W, null, 128)]);
});

test("a picture that wouldn't load is deleted from this version's folder and drawn again", (t) => {
  const name = pfpKey(W, PFP, 128, "17");
  const r = rig(t, { onDisk: [at(name), name, "pfp-version"] });
  r.want(W, PFP, 128);
  r.cache.forget(name);
  r.cache.forget("pfp-version"); // not a picture
  r.cache.forget("../pfp-version");
  assert.deepEqual([...r.disk.keys()], [name, "pfp-version"], "only the one in pfp-v17");
  r.want(W, PFP, 128);
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent, [{ id: "1", wallet: W, pfp: PFP, px: 128 }]);
});

test("the first page of a run clears out other versions, the first build's loose files and half-written pictures", (t) => {
  const kept = at(pfpKey(W, PFP, 128, "17"));
  const loose = pfpKey(V, null, 128, "17");
  const others = ["expo-image/x.png", "ImagePicker/a.jpg", "pfp-notes.txt"];
  const r = rig(t, { onDisk: [kept, `${kept.slice(0, -4)}0.png.part`, loose, `${loose}.part`, "pfp-version", ...others] });
  r.want(V, null, 256);
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual([...r.disk.keys()].sort(), [kept, ...others].sort());
  assert.deepEqual([...r.dirs].sort(), ["pfp-v17", "expo-image", "ImagePicker"].sort());
  assert.equal(r.changes(), 1, "the same version: nothing renamed");
});

test("a phone with every picture on disk loads the page once, only to hear the version", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(t, { onDisk: [at(pfpKey(W, PFP, 128, "17"))] });
  r.want(W, PFP, 128);
  assert.equal(r.cache.wanted(), false);
  r.cache.check();
  assert.equal(r.cache.wanted(), true);
  r.open();
  r.answer({ ready: true, version: "17" });
  assert.deepEqual(r.sent, [], "nothing to draw");
  assert.equal(r.cache.version(), "17");
  t.mock.timers.tick(59_999);
  assert.equal(r.cache.wanted(), true);
  t.mock.timers.tick(1);
  assert.equal(r.cache.wanted(), false, "let go after idleMs");
  r.cache.close();
  r.cache.check();
  assert.equal(r.cache.wanted(), false, "once a run");
  assert.equal(r.changes(), 2);
});

test("a new version heard by the check renames every picture, so faces get them drawn again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(t, { onDisk: [at(pfpKey(W, PFP, 128, "17"))] });
  let seen = null;
  r.cache.subscribe(() => (seen = r.cache.version()));
  r.want(W, PFP, 128);
  r.cache.check();
  r.open();
  r.answer({ ready: true, version: "18" });
  assert.equal(seen, "18", "faces hear the new version");
  assert.deepEqual([...r.dirs], [], "the 17 folder is gone");
  assert.equal(r.cache.cached(pfpKey(W, PFP, 128, "18")), null);
  r.want(W, PFP, 128); // the face, asking under the new name
  assert.deepEqual(r.sent, [{ id: "1", wallet: W, pfp: PFP, px: 128 }]);
  r.answer({ id: "1", png: `${PNG}AAAA` });
  assert.equal(r.got.at(-1), r.uri(W, PFP, 128, "18"));
  assert.equal(r.got.at(-1), `file:///cache/pfp-v18/${pfpKey(W, PFP, 128, "18")}`);
  t.mock.timers.tick(60_000);
  assert.equal(r.cache.wanted(), false);
  r.cache.close();
  r.cache.check();
  assert.equal(r.cache.wanted(), false);
});

test("the version check does nothing while the page is wanted anyway", (t) => {
  const r = rig(t);
  r.want(W, PFP, 128);
  const before = r.changes();
  r.cache.check();
  assert.equal(r.changes(), before);
  r.open();
  r.answer({ ready: true, version: "17" });
  r.answer({ id: "1", png: `${PNG}AAAA` });
  r.cache.check(); // heard this run already
  assert.equal(r.cache.wanted(), true, "still in its idle minute");
  assert.equal(r.changes(), before);
});
