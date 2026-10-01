// Mooner pictures on the phone: a short file name for each (wallet, traits, size), and the
// queue in front of the page that draws them (PfpRenderer.js runs the web app's renderer in
// a hidden WebView). Nothing here imports React Native, so it runs in Node tests with fakes.

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

const PNG = "data:image/png;base64,";

/** `v` with every object's keys in order, so the same traits always give the same JSON. */
const sorted = (v) => {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
};

/** The cache file's name for `wallet`'s picture `pfp` (null: the wallet's default) at `px`. */
export function pfpKey(wallet, pfp, px) {
  const json = JSON.stringify([wallet, sorted(pfp ?? null), px]);
  return `pfp-${bytesToHex(sha256(utf8ToBytes(json))).slice(0, 24)}.png`;
}

/**
 * The pictures asked for in this app run, and the page that draws them. The page gets one
 * picture at a time. Each picture is tried once per run: one the page couldn't draw, or one
 * asked for once the page is down, stays on the fallback face until the app starts again.
 *
 * files:   { uri(name), exists(name), write(name, base64) }   the folder pictures are kept in
 * readyMs: how long an opened page has to say it's ready
 * drawMs:  how long one picture may take; the page draws one at a time, so a page slower
 *          than this is stuck and counts as down
 */
export function makePfpCache({ files, readyMs = 20_000, drawMs = 20_000 }) {
  const uris = new Map(); // name -> file uri, for pictures on disk
  const asked = new Map(); // name -> promise of its uri, for every picture asked for this run
  const queue = []; // { name, ask, resolve, reject }: not sent yet
  let page = null; // { post, onDown, ready, readyTimer } while a WebView is mounted
  let drawing = null; // the job the page is drawing, with its id and timer
  let down = null; // the Error that took the page down
  let ids = 0;

  /** The picture's file uri if it is on disk, else null. */
  function cached(name) {
    if (!uris.has(name) && files.exists(name)) uris.set(name, files.uri(name));
    return uris.get(name) ?? null;
  }

  /** A promise of the file uri of `wallet`'s picture `pfp` (null: its default) at `px`. */
  function request(wallet, pfp, px) {
    const name = pfpKey(wallet, pfp, px);
    let p = asked.get(name);
    if (p) return p;
    const uri = cached(name);
    if (uri) p = Promise.resolve(uri);
    else if (down) p = Promise.reject(down);
    else {
      p = new Promise((resolve, reject) => queue.push({ name, ask: { wallet, pfp: pfp ?? null, px }, resolve, reject }));
      pump();
    }
    p.catch(() => {}); // a picture that fails shows the fallback; it is never an unhandled rejection
    asked.set(name, p);
    return p;
  }

  function pump() {
    if (drawing || !page?.ready || !queue.length) return;
    const job = queue.shift();
    job.id = String(++ids);
    job.timer = setTimeout(() => fail(new Error("a picture took too long to draw")), drawMs);
    drawing = job;
    page.post(JSON.stringify({ id: job.id, ...job.ask }));
  }

  /** A message from the page (JSON): { ready: true }, { id, png } or { id, error }. */
  function message(text) {
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
      pump();
      return;
    }
    const job = drawing;
    if (!job || m.id !== job.id) return;
    clearTimeout(job.timer);
    drawing = null;
    try {
      if (typeof m.png !== "string" || !m.png.startsWith(PNG)) throw new Error(String(m.error || "the page sent no picture"));
      files.write(job.name, m.png.slice(PNG.length));
      const uri = files.uri(job.name);
      uris.set(job.name, uri);
      job.resolve(uri);
    } catch (e) {
      job.reject(e);
    }
    pump();
  }

  /** A WebView with the page is mounted: `post(text)` sends to it, `onDown()` is called once
   *  if the page goes down. */
  function open(post, onDown) {
    if (down) return onDown();
    close();
    page = { post, onDown, ready: false, readyTimer: setTimeout(() => fail(new Error("the picture page didn't load")), readyMs) };
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

  /** The page can't draw (a load or HTTP error, its process gone, too slow): every picture
   *  waiting fails, and none is drawn for the rest of the run. */
  function fail(error) {
    if (down) return;
    down = error;
    const onDown = page?.onDown;
    close();
    for (const job of queue.splice(0)) job.reject(error);
    onDown?.();
  }

  return { cached, request, message, open, close, fail };
}
