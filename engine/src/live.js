// The server's live socket (/api/ws), for the web app and the phone app alike. Screens
// subscribe to topics; the server sends each topic's snapshot, then every change. It
// reconnects on its own, and a reconnect subscribes again, so each topic gets a fresh
// snapshot. No node: imports.
//   client -> { op: "sub" | "unsub", topics }
//   server -> { topic, type: "snapshot" | "upsert" | "remove" | "message" | "missing" | "error", data }
//             or { error } when it refuses a subscription

const CHUNK = 32; // topics per message (the server takes at most 64 per socket)

/** One socket for the whole app. `url`: its address, or a function giving it (read on each
 *  connect). The rest is for tests and for runtimes without a global WebSocket. */
export function makeLive({
  url,
  WebSocket: Socket = globalThis.WebSocket,
  later = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  random = Math.random,
  warn = (line) => console.warn(line),
}) {
  const listeners = new Map(); // topic -> Set<fn>
  const watchers = new Set(); // fn(open)
  let ws = null;
  let open = false;
  let tries = 0;
  let timer = null;

  const address = () => (typeof url === "function" ? url() : url);

  function tell(op, topics) {
    if (!open) return; // sent on (re)connect
    for (let i = 0; i < topics.length; i += CHUNK) ws.send(JSON.stringify({ op, topics: topics.slice(i, i + CHUNK) }));
  }

  function status(up) {
    open = up;
    for (const fn of [...watchers]) fn(up);
  }

  function connect() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (ws) return;
    const sock = new Socket(address());
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      tries = 0;
      status(true);
      tell("sub", [...listeners.keys()]);
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!m?.topic) {
        if (m?.error) warn(`live: ${m.error}`);
        return;
      }
      for (const fn of [...(listeners.get(m.topic) ?? [])]) fn(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (open) status(false);
      if (listeners.size) timer = later(connect, Math.min(15_000, 500 * 2 ** tries++) + random() * 500);
    };
    sock.onerror = () => sock.close();
  }

  /** `fn(msg)` hears `topic` until the returned function is called. */
  function subscribe(topic, fn) {
    let set = listeners.get(topic);
    if (!set) {
      listeners.set(topic, (set = new Set()));
      tell("sub", [topic]);
    }
    set.add(fn);
    connect();
    return () => {
      set.delete(fn);
      if (set.size || listeners.get(topic) !== set) return;
      listeners.delete(topic);
      tell("unsub", [topic]);
    };
  }

  /** `fn(open)` now and whenever the socket goes up or down. */
  function onStatus(fn) {
    watchers.add(fn);
    fn(open);
    return () => watchers.delete(fn);
  }

  /** Drops the socket and opens a fresh one now. The phone calls it when the app comes
   *  back to the front: Android may have cut the socket without a close event. */
  function restart() {
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {
        // already closed
      }
    }
    if (open) status(false);
    tries = 0;
    if (listeners.size) connect();
  }

  return { subscribe, onStatus, restart };
}
