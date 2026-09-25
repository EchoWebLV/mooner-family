// A small JSON-over-HTTP layer on node:http: routes, body limits, CORS, rate limits and
// error mapping. No framework, so there's nothing extra to trust.

import http from "node:http";
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
function clientIp(req, trustProxy) {
  const fwd = trustProxy && req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",").at(-1).trim();
  return req.socket.remoteAddress ?? "?";
}

/**
 * routes: [{ method, path: RegExp (named groups become params), body: max bytes, handler }]
 * A handler gets { params, body, ip, url } and returns { status?, json }.
 */
export function createServer(routes, { cors = "*", trustProxy = false, log = console.log } = {}) {
  const server = http.createServer(async (req, res) => {
    const reply = (status, json) => {
      const body = toJson(json);
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": cors,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    };
    try {
      const url = new URL(req.url, "http://x");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": cors,
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
      if (!hit) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");
      const body = req.method === "POST" ? await readBody(req, hit.r.body ?? 65_536) : {};
      const out = await hit.r.handler({ params: hit.params, body, ip: clientIp(req, trustProxy), url });
      reply(out.status ?? 200, out.json);
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message, ...e.extra });
      if (e instanceof Refused) return reply(403, { error: e.message });
      log(`${req.method} ${req.url}: ${e.stack ?? e}`);
      reply(500, { error: "internal error" });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
