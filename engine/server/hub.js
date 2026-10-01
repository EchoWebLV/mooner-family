// The live socket (GET /api/ws): browsers subscribe to topics and the server pushes each
// change as it happens. What's on a topic, and when it changes, is feed.js's job; this
// file only keeps the sockets, their topics and their limits.
//
//   client -> { op: "sub" | "unsub", topics: [...] }
//   server -> { topic, type, data }        (type: snapshot, upsert, remove, message, missing)
//   server -> { error }                    (a bad request; the socket stays open)
//
// Topics: presales, launched, profiles, sol, chat:global, chat:<presale>, presale:<presale>,
// wallet:<wallet>, coin:<mint>.

import { WebSocketServer } from "ws";
import { Limiter, clientIp, toJson } from "./http.js";

export const TOPIC = /^(presales|launched|profiles|sol|chat:global|(chat|presale|wallet|coin):[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export const HUB_LIMITS = {
  socketsPerIp: 20,
  topicsPerSocket: 64,
  walletsPerSocket: 4,
  coinsPerSocket: 4,
  messages: [120, 60_000], // per socket
  maxBuffered: 4 * 1024 * 1024, // a socket this far behind is dropped
};

/**
 * `server`: the http.Server (createServer). `onFirst(topic)` / `onLast(topic)`: the first
 * socket joined a topic, the last one left (start or stop watching it). `onSub(topic,
 * send)`: a socket joined, or subscribed again to a topic it has; `send(msg)` goes to that
 * socket only (its snapshot).
 */
export class Hub {
  constructor(server, { path = "/api/ws", trustProxy = false, limits = {}, heartbeatMs = 30_000, onFirst = () => {}, onLast = () => {}, onSub = () => {}, log = console.log, now = Date.now } = {}) {
    Object.assign(this, { onFirst, onLast, onSub, log });
    this.L = { ...HUB_LIMITS, ...limits };
    this.topics = new Map(); // topic -> Set<socket>
    this.perIp = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4_096, perMessageDeflate: false });

    server.on("upgrade", (req, sock, head) => {
      let url;
      try {
        url = new URL(req.url, "http://x");
      } catch {
        return sock.destroy();
      }
      if (url.pathname !== path) return sock.destroy();
      const ip = clientIp(req, trustProxy);
      if ((this.perIp.get(ip) ?? 0) >= this.L.socketsPerIp) {
        sock.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
        return;
      }
      this.wss.handleUpgrade(req, sock, head, (ws) => this.attach(ws, ip, now));
    });

    this.beat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
      }
    }, heartbeatMs);
    this.beat.unref();
  }

  attach(ws, ip, now) {
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    ws.alive = true;
    ws.subs = new Set();
    const rate = new Limiter(...this.L.messages, now);
    const say = (msg) => this.send(ws, msg);

    ws.on("pong", () => (ws.alive = true));
    ws.on("message", (raw, binary) => {
      if (binary) return say({ error: "send JSON text" });
      if (!rate.take("m")) return say({ error: "too many messages, slow down" });
      let m;
      try {
        m = JSON.parse(raw.toString("utf8"));
      } catch {
        return say({ error: "not JSON" });
      }
      const list = Array.isArray(m?.topics) ? m.topics : [];
      if (!["sub", "unsub"].includes(m?.op) || !list.length || list.length > this.L.topicsPerSocket) {
        return say({ error: 'send { op: "sub" | "unsub", topics: [...] }' });
      }
      for (const t of list) {
        if (typeof t !== "string" || !TOPIC.test(t)) {
          say({ error: `unknown topic ${String(t).slice(0, 60)}` });
          continue;
        }
        if (m.op === "unsub") this.leave(ws, t);
        else this.join(ws, t);
      }
    });
    ws.on("close", () => {
      for (const t of ws.subs) this.leave(ws, t);
      const n = (this.perIp.get(ip) ?? 1) - 1;
      if (n > 0) this.perIp.set(ip, n);
      else this.perIp.delete(ip);
    });
    ws.on("error", () => {});
  }

  join(ws, topic) {
    // a topic the socket has: its state once more (a second screen on it asked), and none
    // of the limits, which count each topic once
    if (ws.subs.has(topic)) return this.state(ws, topic);
    if (ws.subs.size >= this.L.topicsPerSocket) return this.send(ws, { error: `at most ${this.L.topicsPerSocket} topics` });
    if (topic.startsWith("wallet:") && [...ws.subs].filter((t) => t.startsWith("wallet:")).length >= this.L.walletsPerSocket) {
      return this.send(ws, { error: `at most ${this.L.walletsPerSocket} wallets` });
    }
    if (topic.startsWith("coin:") && [...ws.subs].filter((t) => t.startsWith("coin:")).length >= this.L.coinsPerSocket) {
      return this.send(ws, { error: `at most ${this.L.coinsPerSocket} coins` });
    }
    ws.subs.add(topic);
    let set = this.topics.get(topic);
    const first = !set;
    if (first) this.topics.set(topic, (set = new Set()));
    set.add(ws);
    try {
      if (first) this.onFirst(topic);
    } catch (e) {
      return this.log(`ws ${topic}: ${e.stack ?? e}`);
    }
    this.state(ws, topic);
  }

  /** `topic`'s state (its snapshot, or "missing") to `ws` alone. */
  state(ws, topic) {
    try {
      this.onSub(topic, (msg) => this.send(ws, { topic, ...msg }));
    } catch (e) {
      this.log(`ws ${topic}: ${e.stack ?? e}`);
    }
  }

  leave(ws, topic) {
    if (!ws.subs.delete(topic)) return;
    const set = this.topics.get(topic);
    set?.delete(ws);
    if (set && !set.size) {
      this.topics.delete(topic);
      try {
        this.onLast(topic);
      } catch (e) {
        this.log(`ws ${topic}: ${e.stack ?? e}`);
      }
    }
  }

  send(ws, msg) {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > this.L.maxBuffered) return ws.terminate();
    ws.send(typeof msg === "string" ? msg : toJson(msg));
  }

  /** Someone is on `topic`. */
  has(topic) {
    return this.topics.has(topic);
  }

  /** `msg` to everyone on `topic`. */
  publish(topic, msg) {
    const set = this.topics.get(topic);
    if (!set) return;
    const text = toJson({ topic, ...msg });
    for (const ws of set) this.send(ws, text);
  }

  get sockets() {
    return this.wss.clients.size;
  }

  close() {
    clearInterval(this.beat);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}
