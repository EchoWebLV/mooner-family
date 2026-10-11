// A small JSON-over-HTTP layer on node:http: routes, body limits, CORS, rate limits and
// error mapping, plus the built web app's files. No framework, so there's nothing extra
// to trust. Live updates ride a WebSocket on the same server (hub.js).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Refused } from "../src/cosigner.js";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    Object.assign(this, { status, extra });
  }
}

/** BigInt as a decimal string; PublicKey has its own toJSON (base58). */
export const toJson = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));

/** At most `max` hits per `windowMs` for each key. */
export class Limiter {
  constructor(max, windowMs, now = Date.now) {
    Object.assign(this, { max, windowMs, now, hits: new Map(), calls: 0 });
  }

  take(key) {
    const t = this.now();
    if (++this.calls % 1000 === 0) this.sweep(t);
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  sweep(t) {
    for (const [k, hs] of this.hits) if (!hs.some((h) => t - h < this.windowMs)) this.hits.delete(k);
  }
}

export function limit(limiter, key, what) {
  if (!limiter.take(key)) throw new HttpError(429, `too many ${what}, try again later`);
}

async function readBody(req, maxBytes) {
  const parts = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new HttpError(413, `body over ${maxBytes} bytes`);
    parts.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new HttpError(400, "the body is not JSON");
  }
}

/** The client's address. Behind a proxy (`trustProxy`) it's the last X-Forwarded-For
 *  entry, the one our proxy added; the ones before it are whatever the client sent. */
export function clientIp(req, trustProxy) {
  const fwd = trustProxy && req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",").at(-1).trim();
  return req.socket.remoteAddress ?? "?";
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The web app's file for `pathname` under `root`, or its index.html for an app route (a
 *  path with no extension): the one in the route's top folder if it has one (the
 *  simulation at /sim), else the site's. null: nothing to serve. Dotfiles and paths
 *  outside `root` are never served. */
export function webFile(root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0") || rel.split("/").some((seg) => seg.startsWith("."))) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  if (path.extname(rel)) return null;
  const top = rel.split("/").find(Boolean);
  const own = top && path.join(root, top, "index.html");
  if (own && fs.statSync(own, { throwIfNoEntry: false })?.isFile()) return own;
  const index = path.join(root, "index.html");
  return fs.existsSync(index) ? index : null;
}

function sendFile(res, root, file, method) {
  const hashed = path.relative(root, file).split(path.sep).slice(0, -1).includes("assets"); // Vite names these by content
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  if (method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

/**
 * routes: [{ method, path: RegExp (named groups become params), body: max bytes, cors?, handler }]
 * A handler gets { params, body, ip, url } and returns { status?, json, type? } (type: the
 * content-type; JSON in UTF-8 by default), or { raw } in place of json: text sent as it is,
 * or { location }: a redirect there (302 unless `status` says otherwise).
 * `cors: false` on a route: no Access-Control-Allow-Origin on its path, so only our own
 * pages (and apps, which have no CORS) can read it.
 * `web`: the built web app's folder (absolute), served for GETs outside /api/.
 */
export function createServer(routes, { cors = "*", trustProxy = false, log = console.log, web = null } = {}) {
  const server = http.createServer(async (req, res) => {
    let origin = cors; // null: no CORS on this path
    const reply = (status, json, type = "application/json; charset=utf-8", raw = undefined) => {
      const body = raw ?? toJson(json);
      res.writeHead(status, {
        "content-type": type,
        ...(origin !== null && { "access-control-allow-origin": origin }),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    };
    try {
      const url = new URL(req.url, "http://x");
      if (routes.some((r) => r.cors === false && url.pathname.match(r.path))) origin = null;
      if (req.method === "OPTIONS") {
        res.writeHead(204, origin === null ? {} : {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
        });
        return res.end();
      }
      let hit = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = url.pathname.match(r.path);
        if (!m) continue;
        pathMatched = true;
        if (r.method === req.method) {
          hit = { r, params: m.groups ?? {} };
          break;
        }
      }
      if (!hit && web && !pathMatched && (req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/api/")) {
        const file = webFile(web, url.pathname);
        if (file) return sendFile(res, web, file, req.method);
      }
      if (!hit) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");
      const body = req.method === "POST" ? await readBody(req, hit.r.body ?? 65_536) : {};
      const out = await hit.r.handler({ params: hit.params, body, ip: clientIp(req, trustProxy), url });
      if (out.location) {
        res.writeHead(out.status ?? 302, { location: out.location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
        return res.end();
      }
      reply(out.status ?? 200, out.json, out.type, out.raw);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.cause) log(`${req.method} ${req.url}: ${e.cause.stack ?? e.cause}`); // one that carries its cause (api.js's 500s, rpcproxy.js's 502s)
        return reply(e.status, { error: e.message, ...e.extra });
      }
      if (e instanceof Refused) return reply(403, { error: e.message });
      log(`${req.method} ${req.url}: ${e.stack ?? e}`);
      reply(500, { error: "internal error" });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
