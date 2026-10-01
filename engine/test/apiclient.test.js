// The API client the web app and the phone app share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, makeApi } from "../src/apiclient.js";

/** A fetch that answers from `replies` ([status, body] each; a string body isn't JSON)
 *  and keeps every call. */
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const [status, body] = replies.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body) };
  };
  fn.calls = calls;
  return fn;
}

test("calls go to base + path, with a JSON body", async () => {
  const f = fakeFetch([[200, { token: "t", exp: 9 }]]);
  const api = makeApi("https://app.mooner.family", f);
  assert.deepEqual(await api.login({ wallet: "w", time: 1, signature: "s" }), { token: "t", exp: 9 });
  assert.equal(f.calls[0].url, "https://app.mooner.family/api/login");
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { wallet: "w", time: 1, signature: "s" });
});

test("same origin by default; a GET carries no body", async () => {
  const f = fakeFetch([[200, { presales: [1] }]]);
  assert.deepEqual(await makeApi("", f).presales(), [1]);
  assert.equal(f.calls[0].url, "/api/presales");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.body, undefined);
});

test("a refusal throws the server's message; a non-JSON error says the status", async () => {
  const f = fakeFetch([[400, { error: "time is off" }], [502, "<html>bad gateway</html>"]]);
  const api = makeApi("", f);
  await assert.rejects(api.login({}), (e) => e instanceof ApiError && e.status === 400 && e.message === "time is off" && e.body.error === "time is off");
  await assert.rejects(api.info(), (e) => e instanceof ApiError && e.status === 502 && e.message === "the server said 502" && e.body === null);
});

test("a 200 that isn't JSON (a proxy's HTML page) throws instead of handing back null", async () => {
  const f = fakeFetch([[200, "<html>hello</html>"]]);
  await assert.rejects(makeApi("", f).presales(), (e) => e instanceof ApiError && e.status === 200 && e.message === "the server's reply wasn't JSON" && e.body === null);
});

test("cosign returns status and body, balance is a number, chat pages with after", async () => {
  const f = fakeFetch([[200, { sig: "x", confirmed: false }], [200, { lamports: "1500" }], [200, { messages: [] }]]);
  const api = makeApi("", f);
  assert.deepEqual(await api.cosign("AAAA"), { status: 200, json: { sig: "x", confirmed: false } });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { tx: "AAAA" });
  assert.equal(await api.balance("w"), 1500);
  assert.deepEqual(await api.chat("global", 7), []);
  assert.equal(f.calls[2].url, "/api/chat/global?after=7");
});

// ---- deadlines ----

/** A fetch that never answers (it does see the abort: `signals` keeps each call's). */
function hangingFetch() {
  const signals = [];
  const fn = (url, init) => (signals.push(init.signal), new Promise(() => {}));
  fn.signals = signals;
  return fn;
}

/** Lets pending promises run (setImmediate isn't mocked here). */
const settle = () => new Promise((r) => setImmediate(r));

test("a call the server never answers gives up after 10 s: an ApiError with status 0 and timedOut, the request aborted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = hangingFetch();
  let end = null;
  makeApi("", f).presales().then(() => (end = "answered"), (e) => (end = e));
  await settle();
  t.mock.timers.tick(9_999);
  await settle();
  assert.equal(end, null, "still waiting just before 10 s");
  t.mock.timers.tick(1);
  await settle();
  assert.ok(end instanceof ApiError);
  assert.equal(end.status, 0);
  assert.equal(end.timedOut, true);
  assert.equal(end.message, "the server didn't answer in 10 s");
  assert.equal(end.body, null);
  assert.equal(f.signals[0].aborted, true);
});

test("cosign gets 90 s: the server sends the tx and waits up to 60 s for it, plus rate limits", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let end = null;
  makeApi("", hangingFetch()).cosign("AAAA").then(() => (end = "answered"), (e) => (end = e));
  await settle();
  t.mock.timers.tick(89_999);
  await settle();
  assert.equal(end, null, "still waiting just before 90 s");
  t.mock.timers.tick(1);
  await settle();
  assert.equal(end?.timedOut, true);
  assert.equal(end.status, 0);
  assert.equal(end.message, "the server didn't answer in 90 s");
});

test("deadlines can be set: a reply whose body never comes is given up too; an answer clears the timer", async () => {
  // the reply is in, its body never is
  const noBody = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const api = makeApi("", noBody, { ms: 20, cosignMs: 40 });
  const t0 = Date.now();
  await assert.rejects(api.info(), { timedOut: true, status: 0, message: "the server didn't answer in 0.02 s" });
  await assert.rejects(api.cosign("AAAA"), { timedOut: true, message: "the server didn't answer in 0.04 s" });
  assert.ok(Date.now() - t0 < 1_000);
  // an answer in time: the request isn't aborted later
  let signal = null;
  const ok = async (url, init) => ((signal = init.signal), { ok: true, status: 200, json: async () => ({ presales: [] }) });
  assert.deepEqual(await makeApi("", ok, { ms: 20 }).presales(), []);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(signal.aborted, false);
  // a refusal is the server's, as before
  const no = async () => ({ ok: false, status: 400, json: async () => ({ error: "time is off" }) });
  await assert.rejects(makeApi("", no, { ms: 20 }).login({}), (e) => e instanceof ApiError && e.status === 400 && e.message === "time is off" && e.timedOut === undefined);
});
