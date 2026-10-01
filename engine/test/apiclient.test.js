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
