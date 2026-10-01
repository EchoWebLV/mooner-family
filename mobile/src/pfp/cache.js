// Mooner pictures on the phone: a short file name for each (wallet, traits, size, renderer
// version), and the queue in front of the page that draws them (PfpRenderer.js runs the web
// app's renderer in a hidden WebView). Nothing here imports React Native, so it runs in Node
// tests with fakes.

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

const PNG = "data:image/png;base64,";
/** The longest data URL the page may send; a 512 px picture is far below it. */
const MAX_PNG = 2_000_000;
/** What pfpKey names look like: forget() deletes nothing else. */
const NAME = /^pfp-[0-9a-f]{24}\.png$/;

/** `v` with every object's keys in order, so the same traits always give the same JSON. */
const sorted = (v) => {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
};

/** The cache file's name for `wallet`'s picture `pfp` (null: the wallet's default) at `px`,
 *  drawn by renderer `version` (null: not known yet). */
export function pfpKey(wallet, pfp, px, version) {
  const json = JSON.stringify([wallet, sorted(pfp ?? null), px, version ?? null]);
  return `pfp-${bytesToHex(sha256(utf8ToBytes(json))).slice(0, 24)}.png`;
}

/**
 * The pictures wanted in this app run, and the page that draws them, one at a time. A picture
 * the page couldn't draw is tried once per run; once the page is down (it didn't load, it
 * crashed, it got stuck) nothing more is drawn until the app starts again. Faces without a
 * picture show their fallback.
 *
 * files:       { uri(name), exists(name), write(name, base64), rename(from, to), remove(name) }
 *              the folder pictures are kept in
 * origin:      where the page is served; messages from anywhere else are ignored
 * version:     the renderer version the kept pictures were drawn with (null: not known);
 *              saveVersion(v) keeps the one the page reports when it differs
 * readyMs:     how long an opened page has to say it's ready
 * drawMs:      how long one picture may take; a page slower than this is stuck: down
 * idleMs:      how long the page stays wanted with nothing to draw
 *
 * subscribe(fn) hears wanted() (a page should be mounted) and version() change.
 */
export function makePfpCache({
  files,
  origin,
  version = null,
  saveVersion = () => {},
  readyMs = 20_000,
  drawMs = 20_000,
  idleMs = 60_000,
}) {
  const uris = new Map(); // name -> file uri, for pictures on disk
  const jobs = new Map(); // name -> { name, ask, waiters, id?, timer? }: queued or being drawn
  const failed = new Set(); // names the page couldn't draw this run
  const queue = []; // jobs not sent yet
  const listeners = new Set();
  let page = null; // { post, ready, readyTimer } while a WebView is mounted
  let drawing = null; // the job the page is drawing
  let down = null; // the Error that took the page down
  let wanted = false;
  let idleTimer = null;
  let killed = false; // Android has stopped the page's process once already
  let ids = 0;

  const emit = () => listeners.forEach((fn) => fn());
  const nameOf = (wallet, pfp, px) => pfpKey(wallet, pfp, px, version);

  /** The picture's file uri if it is on disk, else null. */
  function cached(name) {
    if (!uris.has(name) && files.exists(name)) uris.set(name, files.uri(name));
    return uris.get(name) ?? null;
  }

  /** Calls onUri(uri) once `wallet`'s picture `pfp` (null: its default) at `px` is on disk,
   *  at once if it already is. Returns off(): a picture nobody waits for any more is dropped
   *  unless the page is already drawing it (a face that showed a default picture before the
   *  wallet's saved one arrived doesn't keep the page busy). */
  function want(wallet, pfp, px, onUri) {
    const name = nameOf(wallet, pfp, px);
    const uri = cached(name);
    if (uri) {
      onUri(uri);
      return () => {};
    }
    if (down || failed.has(name)) return () => {};
    let job = jobs.get(name);
    if (!job) {
      job = { name, ask: { wallet, pfp: pfp ?? null, px }, waiters: new Set() };
      jobs.set(name, job);
      queue.push(job);
    }
    job.waiters.add(onUri);
    busy();
    pump();
    return () => {
      job.waiters.delete(onUri);
      const i = queue.indexOf(job);
      if (job.waiters.size || i < 0) return;
      queue.splice(i, 1);
      jobs.delete(job.name);
      idle();
    };
  }

  function pump() {
    if (drawing || !page?.ready || !queue.length) return;
    const job = queue.shift();
    job.id = String(++ids);
    job.timer = setTimeout(() => fail(new Error("a picture took too long to draw")), drawMs);
    drawing = job;
    page.post(JSON.stringify({ id: job.id, ...job.ask }));
  }

  function busy() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (!wanted) {
      wanted = true;
      emit();
    }
  }

  /** Nothing left to draw: the page is let go after idleMs unless more comes. */
  function idle() {
    if (!wanted || drawing || queue.length || idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      wanted = false;
      emit();
    }, idleMs);
  }

  /** The page reports another renderer version: pictures kept so far are old. Waiting ones
   *  get their new names (any already on disk under it is done). */
  function newVersion(v) {
    version = v;
    try {
      saveVersion(v);
    } catch (e) {
      console.warn("pfp:", e.message);
    }
    uris.clear();
    failed.clear();
    jobs.clear();
    for (const job of queue.splice(0)) {
      job.name = nameOf(job.ask.wallet, job.ask.pfp, job.ask.px);
      const uri = cached(job.name);
      if (uri) job.waiters.forEach((fn) => fn(uri));
      else {
        jobs.set(job.name, job);
        queue.push(job);
      }
    }
    emit();
  }

  /** A message from the page: JSON `text`, sent from `from`: the page's origin (WebViews
   *  with WebMessageListener) or its URL (older ones). */
  function message(text, from) {
    if (from !== origin && !from?.startsWith(`${origin}/`)) return;
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!page || !m || typeof m !== "object") return;
    if (m.ready) {
      clearTimeout(page.readyTimer);
      page.ready = true;
      if (m.version != null && String(m.version) !== version) newVersion(String(m.version));
      pump();
      idle();
      return;
    }
    const job = drawing;
    if (!job || m.id !== job.id) return;
    clearTimeout(job.timer);
    drawing = null;
    jobs.delete(job.name);
    let uri = null;
    try {
      if (typeof m.png !== "string" || !m.png.startsWith(PNG)) throw new Error(String(m.error || "the page sent no picture"));
      if (m.png.length > MAX_PNG) throw new Error("the page sent a picture too big to keep");
      // a file under the picture's name is always whole: the app may be stopped mid-write
      files.write(`${job.name}.part`, m.png.slice(PNG.length));
      files.rename(`${job.name}.part`, job.name);
      uri = files.uri(job.name);
      uris.set(job.name, uri);
    } catch (e) {
      failed.add(job.name);
      console.warn("pfp:", e.message);
    }
    if (uri) job.waiters.forEach((fn) => fn(uri));
    pump();
    idle();
  }

  /** A WebView with the page is mounted: `post(text)` sends to it. */
  function open(post) {
    if (down) return;
    close();
    page = { post, ready: false, readyTimer: setTimeout(() => fail(new Error("the picture page didn't load")), readyMs) };
  }

  /** The WebView is unmounted: the picture it was drawing waits for the next one. */
  function close() {
    if (!page) return;
    clearTimeout(page.readyTimer);
    page = null;
    if (drawing) {
      clearTimeout(drawing.timer);
      queue.unshift(drawing);
      drawing = null;
    }
  }

  /** The page's process is gone. The first time Android stops it (it does that to save
   *  memory, didCrash false) this returns true: mount the page again. A crash, or a second
   *  stop, takes the page down. */
  function gone(didCrash) {
    if (didCrash || killed) {
      fail(new Error(didCrash ? "the picture page crashed" : "the picture page was stopped twice"));
      return false;
    }
    killed = true;
    close();
    return true;
  }

  /** The page can't draw (a load or HTTP error, a crash, too slow): every waiting picture is
   *  dropped and none is drawn for the rest of the run. */
  function fail(error) {
    if (down) return;
    down = error;
    console.warn("pfp page down:", error.message);
    close();
    queue.length = 0;
    jobs.clear();
    clearTimeout(idleTimer);
    idleTimer = null;
    emit();
  }

  /** Deletes picture `name` (one that wouldn't load) so it is drawn again next time. */
  function forget(name) {
    if (!NAME.test(name)) return;
    uris.delete(name);
    try {
      files.remove(name);
    } catch (e) {
      console.warn("pfp:", e.message);
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    cached,
    want,
    message,
    open,
    close,
    gone,
    fail,
    forget,
    subscribe,
    wanted: () => wanted && !down,
    version: () => version,
  };
}
