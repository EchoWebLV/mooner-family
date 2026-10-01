// The live socket client (engine/src/live.js) against a fake WebSocket and fake timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLive } from "../src/live.js";

function rig({ url = "wss://x/api/ws" } = {}) {
  const made = [];
  class FakeSocket {
    constructor(u) {
      this.url = u;
      this.sent = [];
      this.closed = false;
      made.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    }
    up() {
      this.onopen?.();
    }
    fail() {
      // an error, then the close that follows it; a close() after that is a no-op, as in
      // browsers and React Native, where the socket is already CLOSED
      this.closed = true;
      this.onerror?.();
      this.onclose?.();
    }
    push(msg) {
      this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
    }
  }
  const timers = [];
  const warned = [];
  const live = makeLive({
    url,
    WebSocket: FakeSocket,
    later: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    cancel: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    random: () => 0,
    warn: (line) => warned.push(line),
  });
  const fire = () => timers.shift().fn();
  return { live, made, timers, warned, fire };
}

test("subscribes once the socket opens, and hands each message to its topic's listeners", () => {
  const { live, made } = rig();
  const got = [];
  live.subscribe("presales", (m) => got.push(m));
  assert.equal(made.length, 1);
  assert.equal(made[0].url, "wss://x/api/ws");
  assert.deepEqual(made[0].sent, []); // nothing before open
  made[0].up();
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["presales"] }]);
  made[0].push({ topic: "presales", type: "snapshot", data: [] });
  made[0].push({ topic: "launched", type: "snapshot", data: [] });
  assert.deepEqual(got, [{ topic: "presales", type: "snapshot", data: [] }]);
});

test("two listeners share a topic; the last one out unsubscribes", () => {
  const { live, made } = rig();
  const offA = live.subscribe("sol", () => {});
  const offB = live.subscribe("sol", () => {});
  made[0].up();
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["sol"] }]);
  offA();
  assert.equal(made[0].sent.length, 1);
  offB();
  assert.deepEqual(made[0].sent[1], { op: "unsub", topics: ["sol"] });
});

test("a topic subscribed while open is sent at once", () => {
  const { live, made } = rig();
  live.subscribe("a", () => {});
  made[0].up();
  live.subscribe("b", () => {});
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["a"] }, { op: "sub", topics: ["b"] }]);
});

test("topics go 32 to a message", () => {
  const { live, made } = rig();
  for (let i = 0; i < 40; i++) live.subscribe(`t${i}`, () => {});
  made[0].up();
  assert.deepEqual(made[0].sent.map((m) => m.topics.length), [32, 8]);
});

test("reconnects with a growing wait and subscribes again", () => {
  const { live, made, timers, fire } = rig();
  live.subscribe("presales", () => {});
  made[0].up();
  made[0].close();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 500);
  fire();
  assert.equal(made.length, 2);
  made[1].close(); // fails before opening
  assert.equal(timers[0].ms, 1_000);
  fire();
  made[2].up();
  assert.deepEqual(made[2].sent, [{ op: "sub", topics: ["presales"] }]);
});

test("the wait stops growing at 15 s", () => {
  const { live, made, timers, fire } = rig();
  live.subscribe("x", () => {});
  for (let i = 0; i < 10; i++) {
    made[made.length - 1].close();
    if (i < 9) fire();
  }
  assert.equal(timers[0].ms, 15_000);
});

test("no reconnect when nobody listens", () => {
  const { live, made, timers } = rig();
  const off = live.subscribe("x", () => {});
  made[0].up();
  off();
  made[0].close();
  assert.equal(timers.length, 0);
});

test("onStatus tells now and on every change", () => {
  const { live, made } = rig();
  const seen = [];
  live.subscribe("x", () => {});
  live.onStatus((up) => seen.push(up));
  made[0].up();
  made[0].close();
  assert.deepEqual(seen, [false, true, false]);
});

test("junk is ignored and a refusal is logged", () => {
  const { live, made, warned } = rig();
  const got = [];
  live.subscribe("x", (m) => got.push(m));
  made[0].up();
  made[0].push("not json");
  made[0].push({ error: "at most 64 topics" });
  assert.deepEqual(got, []);
  assert.deepEqual(warned, ["live: at most 64 topics"]);
});

test("a listener may unsubscribe while a message is handed out", () => {
  const { live, made } = rig();
  const got = [];
  const off = live.subscribe("x", () => off());
  live.subscribe("x", (m) => got.push(m.type));
  made[0].up();
  made[0].push({ topic: "x", type: "snapshot" });
  assert.deepEqual(got, ["snapshot"]);
});

test("restart drops the old socket and opens a fresh one at once", () => {
  const { live, made, timers } = rig();
  const seen = [];
  const heard = [];
  live.subscribe("x", (m) => heard.push(m));
  made[0].up();
  live.onStatus((up) => seen.push(up));
  live.restart();
  assert.equal(made[0].closed, true);
  assert.equal(made.length, 2);
  assert.equal(timers.length, 0);
  assert.deepEqual(seen, [true, false]);
  made[0].push({ topic: "x", type: "snapshot" }); // the old socket is no longer heard
  assert.deepEqual(heard, []);
  made[1].up();
  assert.deepEqual(made[1].sent, [{ op: "sub", topics: ["x"] }]);
});

test("restart with nobody listening opens nothing", () => {
  const { live, made } = rig();
  live.restart();
  assert.equal(made.length, 0);
});

test("url may be a function, read on each connect", () => {
  let n = 0;
  const { live, made, fire } = rig({ url: () => `wss://x/${++n}` });
  live.subscribe("x", () => {});
  made[0].close();
  fire();
  assert.deepEqual(made.map((s) => s.url), ["wss://x/1", "wss://x/2"]);
});

test("restart during a wait cancels it, connects now, and starts the wait over", () => {
  const { live, made, timers, fire } = rig();
  live.subscribe("x", () => {});
  made[0].close();
  fire();
  made[1].close();
  assert.equal(timers[0].ms, 1_000);
  live.restart();
  assert.equal(timers.length, 0);
  assert.equal(made.length, 3);
  made[2].close();
  assert.equal(timers[0].ms, 500);
});

test("an open starts the wait over", () => {
  const { live, made, timers, fire } = rig();
  live.subscribe("x", () => {});
  made[0].close();
  fire();
  made[1].close();
  fire();
  made[2].up();
  made[2].close();
  assert.equal(timers[0].ms, 500);
});

test("a new topic during a wait connects at once", () => {
  const { live, made, timers } = rig();
  live.subscribe("x", () => {});
  made[0].close();
  assert.equal(timers.length, 1);
  live.subscribe("y", () => {});
  assert.equal(timers.length, 0);
  assert.equal(made.length, 2);
});

test("an error closes the socket and reconnects once", () => {
  const { live, made, timers } = rig();
  live.subscribe("x", () => {});
  made[0].up();
  made[0].fail();
  assert.equal(timers.length, 1);
  assert.equal(made.length, 1);
});

test("calling off twice leaves a later subscriber of the topic alone", () => {
  const { live, made } = rig();
  const got = [];
  const off = live.subscribe("x", () => {});
  made[0].up();
  off();
  live.subscribe("x", (m) => got.push(m.type));
  off();
  assert.deepEqual(made[0].sent.map((m) => m.op), ["sub", "unsub", "sub"]);
  made[0].push({ topic: "x", type: "snapshot" });
  assert.deepEqual(got, ["snapshot"]);
});

test("a listener added while a message is handed out hears the next one, not the current one", () => {
  const { live, made } = rig();
  const got = [];
  let added = false;
  live.subscribe("x", () => {
    if (added) return;
    added = true;
    live.subscribe("x", (m) => got.push(m.type));
  });
  made[0].up();
  made[0].push({ topic: "x", type: "first" });
  assert.deepEqual(got, []);
  made[0].push({ topic: "x", type: "second" });
  assert.deepEqual(got, ["second"]);
});

test("a throwing listener does not stop the others, and is warned", () => {
  const { live, made, warned } = rig();
  const got = [];
  live.subscribe("x", () => {
    throw new Error("boom");
  });
  live.subscribe("x", (m) => got.push(m.type));
  made[0].up();
  made[0].push({ topic: "x", type: "snapshot" });
  assert.deepEqual(got, ["snapshot"]);
  assert.deepEqual(warned, ["live: x listener failed: boom"]);
});

test("a throwing status watcher does not stop the subscriptions going out on open, nor the reconnect on close", () => {
  const { live, made, timers, warned } = rig();
  live.subscribe("x", () => {});
  live.onStatus(() => {
    throw new Error("watcher");
  });
  made[0].up();
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["x"] }]);
  made[0].close();
  assert.equal(timers.length, 1);
  assert.deepEqual(warned, [
    "live: status listener failed: watcher", // told at once, on joining
    "live: status listener failed: watcher", // open
    "live: status listener failed: watcher", // closed
  ]);
});

test("the last listener leaving during a wait: when the wait ends, no socket opens", () => {
  const { live, made, timers, fire } = rig();
  const off = live.subscribe("x", () => {});
  made[0].up();
  made[0].close();
  off();
  assert.equal(timers.length, 1);
  fire();
  assert.equal(made.length, 1);
});

test("a watcher told the socket is open finds its topics already sent", () => {
  const { live, made } = rig();
  const seen = [];
  live.subscribe("x", () => {});
  live.onStatus((up) => {
    if (up) seen.push(made[0].sent.length);
  });
  made[0].up();
  assert.deepEqual(seen, [1]);
});

test("a watcher told the socket is down finds the wait already set", () => {
  const { live, made, timers } = rig();
  const seen = [];
  live.subscribe("x", () => {});
  made[0].up();
  live.onStatus((up) => {
    if (!up) seen.push(timers.length);
  });
  made[0].close();
  assert.deepEqual(seen, [1]);
});
