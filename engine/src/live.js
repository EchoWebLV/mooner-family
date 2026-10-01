// The server's live socket (/api/ws), for the web app and the phone app alike. Screens
// subscribe to topics; the server sends each topic's snapshot, then every change. It
// reconnects on its own, and a reconnect subscribes again, so each topic gets a fresh
// snapshot. No node: imports.
//   client -> { op: "sub" | "unsub", topics }
//   server -> { topic, type: "snapshot" | "upsert" | "remove" | "message", data }
//             { topic, type: "missing" }                  (a presale that is not there)
//             { topic, type: "error", error }             (a snapshot it could not read)
//             { error }                                   (it refuses a subscription; logged)
// A listener or a status watcher that throws is logged and skipped; the rest still run.

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

  // Hands `arg` to `fn`; a throw is logged, so one bad listener cannot stop the rest.
  function call(fn, arg, who) {
    try {
      fn(arg);
    } catch (e) {
      warn(`live: ${who} listener failed: ${e?.message ?? e}`);
    }
  }

  function notify(up) {
    for (const fn of [...watchers]) call(fn, up, "status");
  }

  function connect() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (ws || !listeners.size) return; // a wait that ran out after everyone left opens nothing
    const sock = new Socket(address());
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      tries = 0;
      open = true;
      tell("sub", [...listeners.keys()]); // before any watcher runs
      notify(true);
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
      for (const fn of [...(listeners.get(m.topic) ?? [])]) call(fn, m, m.topic);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      const wasOpen = open;
      open = false;
      if (listeners.size) timer = later(connect, Math.min(15_000, 500 * 2 ** tries++) + random() * 500);
      if (wasOpen) notify(false); // after the wait is set, so a watcher may connect at once
    };
    sock.onerror = () => sock.close();
  }

  /** `fn(msg)` hears `topic` until the returned function is called. A topic the socket
   *  has already is asked for again, so the new listener gets its snapshot too; every
   *  listener on the topic hears that one, and each takes a snapshot as the whole state. */
  function subscribe(topic, fn) {
    let set = listeners.get(topic);
    if (!set) listeners.set(topic, (set = new Set()));
    tell("sub", [topic]); // not open yet: the open sends every topic
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
    call(fn, open, "status");
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
    const wasOpen = open;
    open = false;
    if (wasOpen) notify(false);
    tries = 0;
    connect(); // also ends any wait that was running
  }

  return { subscribe, onStatus, restart };
}
