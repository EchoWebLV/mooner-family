// The server's live socket (/api/ws, same origin): one per tab. Screens subscribe to
// topics; the server sends each topic's snapshot, then every change. It reconnects on its
// own, and a reconnect subscribes again, so each topic gets a fresh snapshot.
//   server -> { topic, type: "snapshot" | "upsert" | "remove" | "message" | "missing" | "error", data }

const listeners = new Map(); // topic -> Set<fn>
const watchers = new Set(); // fn(open)
const CHUNK = 32; // topics per message (the server takes at most 64)
let ws = null;
let open = false;
let tries = 0;
let timer = 0;

function address() {
  const u = new URL("/api/ws", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

function tell(op, topics) {
  if (!open) return; // sent on (re)connect
  for (let i = 0; i < topics.length; i += CHUNK) ws.send(JSON.stringify({ op, topics: topics.slice(i, i + CHUNK) }));
}

function status(up) {
  open = up;
  for (const fn of watchers) fn(up);
}

function connect() {
  clearTimeout(timer);
  if (ws) return;
  const sock = new WebSocket(address());
  ws = sock;
  sock.onopen = () => {
    tries = 0;
    status(true);
    tell("sub", [...listeners.keys()]);
  };
  sock.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!m.topic) return m.error && console.warn(`live: ${m.error}`);
    for (const fn of listeners.get(m.topic) ?? []) fn(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (open) status(false);
    if (listeners.size) timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** tries++) + Math.random() * 500);
  };
  sock.onerror = () => sock.close();
}

/** `fn(msg)` hears `topic` until the returned function is called. */
export function subscribe(topic, fn) {
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
export function onStatus(fn) {
  watchers.add(fn);
  fn(open);
  return () => watchers.delete(fn);
}
