// POST /api/rpc: the apps' Solana JSON-RPC over the server's own RPC. A real HTTP server on a
// free port in front of a fake RPC (another HTTP server) that records what reaches it.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Connection } from "@solana/web3.js";
import { createServer } from "../server/http.js";
import { makeRpcRoutes, RPC_METHODS } from "../server/rpcproxy.js";

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((r) => server.close(r));

/** A fake RPC: `answer(call)` returns { status, body (text), type } or hangs (a Promise that
 *  never settles). `calls` holds each request's parsed body and headers. */
async function fakeRpc(answer) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const call = JSON.parse(text);
    calls.push({ call, headers: req.headers, path: req.url });
    const a = await answer(call);
    res.writeHead(a.status ?? 200, { "content-type": a.type ?? "application/json" });
    res.end(a.body);
  });
  const url = await listen(server);
  return { url, calls, close: () => (server.closeAllConnections(), close(server)) };
}

const ok = (call, result) => ({ body: JSON.stringify({ jsonrpc: "2.0", result, id: call.id }) });
const ping = { method: "GET", path: /^\/api\/ping$/, handler: () => ({ json: { ok: true } }) };

/** The proxy in front of a fake RPC at `path` on it (a key there, say); `logs` gets what
 *  the server and the proxy log; `now` drives the limits. */
async function start({ answer = (c) => ok(c, 1), max = 100, total = 1_000, timeoutMs = 2_000, maxAnswer, url = null, path = "", trustProxy = false, now = Date.now } = {}) {
  const rpc = await fakeRpc(answer);
  const logs = [];
  const log = (m) => logs.push(m);
  const routes = makeRpcRoutes({ url: (url ?? rpc.url) + path, limits: { rpcPerIp: [max, 60_000], rpcTotal: [total, 600_000] }, timeoutMs, maxAnswer, log, now });
  const server = createServer([...routes, ping], { log, trustProxy });
  const base = await listen(server);
  const post = (body, { raw = false, headers = {}, signal } = {}) =>
    fetch(`${base}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ? body : JSON.stringify(body), signal });
  // the RPC first: a call stuck on it would keep the server from closing
  return { base, rpc, post, logs, stop: async () => (await rpc.close(), server.closeAllConnections(), await close(server)) };
}

const call = (method, params, id = 7) => ({ jsonrpc: "2.0", id, method, ...(params && { params }) });

test("an allowed call reaches the RPC as sent and its answer comes back byte for byte", async () => {
  // u64::MAX as a JSON number: JSON.parse would round it, so a parse and re-serialize would change it
  const body = '{"jsonrpc":"2.0","result":{"context":{"slot":5},"value":{"lamports":10,"rentEpoch":18446744073709551615}},"id":7}';
  const s = await start({ answer: () => ({ body }) });
  try {
    const r = await s.post(call("getAccountInfo", ["J2fQhCR9efLmJBBdUsqCeEEvUsD4ffauVgYgEpgyrdvv", { encoding: "base64" }]));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^application\/json/);
    assert.equal(await r.text(), body);
    assert.deepEqual(s.rpc.calls.map((c) => c.call), [call("getAccountInfo", ["J2fQhCR9efLmJBBdUsqCeEEvUsD4ffauVgYgEpgyrdvv", { encoding: "base64" }])]);
  } finally {
    await s.stop();
  }
});

test("only jsonrpc, id, method and params go on; no params, none; no id, a null id", async () => {
  const s = await start();
  try {
    await s.post({ ...call("getEpochInfo"), extra: "x", headers: { authorization: "y" } });
    await s.post({ jsonrpc: "2.0", method: "getEpochInfo" });
    await s.post(call("getEpochInfo", undefined, "a-1"));
    assert.deepEqual(s.rpc.calls.map((c) => c.call), [
      { jsonrpc: "2.0", id: 7, method: "getEpochInfo" },
      { jsonrpc: "2.0", id: null, method: "getEpochInfo" },
      { jsonrpc: "2.0", id: "a-1", method: "getEpochInfo" },
    ]);
    assert.equal(s.rpc.calls[0].headers["content-type"], "application/json");
  } finally {
    await s.stop();
  }
});

test("web3.js's Connection works through it (its own request format and headers)", async () => {
  const s = await start({ answer: (c) => ok(c, c.method === "getMinimumBalanceForRentExemption" ? 890_880 : null) });
  try {
    const conn = new Connection(`${s.base}/api/rpc`, "confirmed");
    assert.equal(await conn.getMinimumBalanceForRentExemption(0), 890_880);
    assert.equal(s.rpc.calls[0].call.method, "getMinimumBalanceForRentExemption");
  } finally {
    await s.stop();
  }
});

test("a method that isn't on the list is refused (403) and never reaches the RPC", async () => {
  const s = await start();
  try {
    for (const m of ["getProgramAccounts", "getMultipleAccounts", "getSignaturesForAddress", "getTokenLargestAccounts", "requestAirdrop", "getSlot", "constructor", "__proto__"]) {
      const r = await s.post(call(m, []));
      assert.equal(r.status, 403, m);
      assert.match((await r.json()).error, /isn't served here/);
    }
    assert.equal(s.rpc.calls.length, 0);
  } finally {
    await s.stop();
  }
});

test("the list is what the web and the phone call, and nothing more", () => {
  assert.deepEqual([...RPC_METHODS].sort(), [
    "getAccountInfo", "getBalance", "getEpochInfo", "getFeeForMessage", "getGenesisHash", "getLatestBlockhash", "getMinimumBalanceForRentExemption",
    "getSignatureStatuses", "getTokenAccountsByOwner", "getTransaction", "sendTransaction", "simulateTransaction",
  ]);
});

test("a batch, a body that isn't a JSON-RPC 2.0 call, an id that isn't a number or a string, or no body is a 400 and reaches nothing", async () => {
  const s = await start();
  try {
    const bad = [
      [call("getEpochInfo"), call("getEpochInfo", undefined, 8)], { id: 1, method: "getEpochInfo" }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: 1, method: 5 }, "getEpochInfo", null,
      call("getEpochInfo", undefined, { a: 1 }), call("getEpochInfo", undefined, [1]), call("getEpochInfo", undefined, true),
    ];
    for (const b of bad) assert.equal((await s.post(b)).status, 400, JSON.stringify(b));
    assert.equal((await fetch(`${s.base}/api/rpc`, { method: "POST" })).status, 400);
    assert.equal((await s.post("{not json", { raw: true })).status, 400);
    assert.equal(s.rpc.calls.length, 0);
  } finally {
    await s.stop();
  }
});

test("a body over 8 KiB is a 413", async () => {
  const s = await start();
  try {
    const r = await s.post(call("sendTransaction", ["A".repeat(9_000), { encoding: "base64" }]));
    assert.equal(r.status, 413);
    assert.equal(s.rpc.calls.length, 0);
  } finally {
    await s.stop();
  }
});

test("each IP gets at most rpcPerIp calls a window; refused calls count too", async () => {
  const s = await start({ max: 3 });
  try {
    assert.equal((await s.post(call("getEpochInfo"))).status, 200);
    assert.equal((await s.post(call("getProgramAccounts", []))).status, 403);
    assert.equal((await s.post(call("getEpochInfo"))).status, 200);
    const r = await s.post(call("getEpochInfo"));
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /too many RPC calls/);
    assert.equal(s.rpc.calls.length, 2);
  } finally {
    await s.stop();
  }
});

test("behind a proxy each IP has its own count, and a window that passes frees it", async () => {
  let t = 1_000_000;
  const s = await start({ max: 1, trustProxy: true, now: () => t });
  const from = (ip) => s.post(call("getEpochInfo"), { headers: { "x-forwarded-for": `9.9.9.9, ${ip}` } });
  try {
    assert.equal((await from("1.1.1.1")).status, 200);
    assert.equal((await from("1.1.1.1")).status, 429);
    assert.equal((await from("2.2.2.2")).status, 200);
    t += 59_999;
    assert.equal((await from("1.1.1.1")).status, 429);
    t += 1;
    assert.equal((await from("1.1.1.1")).status, 200);
    assert.equal(s.logs.filter((l) => /first call/.test(l)).join(), "rpc: first call, from 1.1.1.1", "the first caller's IP, once");
  } finally {
    await s.stop();
  }
});

test("everyone together gets at most rpcTotal calls to the RPC; refused calls don't count; going over is in the log once a minute", async () => {
  let t = 1_000_000;
  const s = await start({ total: 2, now: () => t });
  try {
    assert.equal((await s.post(call("getProgramAccounts", []))).status, 403);
    assert.equal((await s.post({ id: 1, method: "getEpochInfo" })).status, 400);
    assert.equal((await s.post(call("getEpochInfo"))).status, 200);
    assert.equal((await s.post(call("getEpochInfo"))).status, 200);
    const r = await s.post(call("getEpochInfo"));
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /busy/);
    assert.equal((await s.post(call("getEpochInfo"))).status, 429);
    assert.equal(s.rpc.calls.length, 2);
    t += 60_000;
    assert.equal((await s.post(call("getEpochInfo"))).status, 429);
    assert.deepEqual(s.logs.filter((l) => /over the limit/.test(l)).map((l) => l.match(/everyone: (\d+)/)[1]), ["1", "2"]);
  } finally {
    await s.stop();
  }
});

test("a JSON-RPC error from the RPC comes back as it came (200, the RPC's own words)", async () => {
  const body = '{"jsonrpc":"2.0","error":{"code":-32002,"message":"Transaction simulation failed: Blockhash not found"},"id":7}';
  const s = await start({ answer: () => ({ body }) });
  try {
    const r = await s.post(call("sendTransaction", ["AQ==", { encoding: "base64" }]));
    assert.equal(r.status, 200);
    assert.equal(await r.text(), body);
  } finally {
    await s.stop();
  }
});

test("the RPC's 429 is a 429, so web3.js backs off and tries again, and it's in the log", async () => {
  const s = await start({ answer: () => ({ status: 429, body: '{"jsonrpc":"2.0","error":{"code":429,"message":"rate limited"},"id":7}' }) });
  try {
    const r = await s.post(call("getEpochInfo"));
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /busy/);
    assert.ok(s.logs.some((l) => /"busy" answers from the RPC: 1/.test(l)), s.logs.join("\n"));
  } finally {
    await s.stop();
  }
});

test("any other RPC failure is a 502 that says nothing of the RPC; the log has the method and the RPC's words, its key taken out", async () => {
  const KEY = "k3y-0123456789abcdef";
  const leaky = `Unauthorized: key ${KEY} for https://rpc.example/v2/${KEY}`;
  const answers = [
    [() => ({ status: 401, body: leaky, type: "text/plain" }), /getEpochInfo: the RPC answered 401: Unauthorized: key … for https:\/\/rpc\.example\/v2\/…/],
    [() => ({ status: 500, body: leaky, type: "text/plain" }), /getEpochInfo: the RPC answered 500/],
    [() => ({ status: 200, body: `<html>${leaky}</html>`, type: "text/html" }), /getEpochInfo: the RPC's answer isn't JSON/],
    [() => ({ status: 503, body: "y".repeat(5_000), type: "text/plain" }), /the RPC answered 503: y{300}(\n|$)/], // only its first 300 bytes
  ];
  for (const [answer, logged] of answers) {
    const s = await start({ answer, path: `/v2/${KEY}` });
    try {
      const r = await s.post(call("getEpochInfo"));
      assert.equal(r.status, 502);
      const text = await r.text();
      assert.doesNotMatch(text, /k3y|rpc\.example|127\.0\.0\.1/);
      assert.match(JSON.parse(text).error, /Solana didn't answer/);
      assert.equal(s.rpc.calls[0].path, `/v2/${KEY}`);
      const log = s.logs.join("\n");
      assert.match(log, logged);
      assert.doesNotMatch(log, /k3y/);
    } finally {
      await s.stop();
    }
  }
});

test("an answer up to maxAnswer bytes comes back; a bigger one is a 502", async () => {
  const sized = (n) => {
    const shell = '{"jsonrpc":"2.0","result":"","id":7}';
    return shell.replace('""', `"${"x".repeat(n - shell.length)}"`);
  };
  for (const [n, status] of [[1_000, 200], [1_001, 502], [50_000, 502]]) {
    const s = await start({ answer: () => ({ body: sized(n) }), maxAnswer: 1_000 });
    try {
      const r = await s.post(call("getAccountInfo", ["J2fQhCR9efLmJBBdUsqCeEEvUsD4ffauVgYgEpgyrdvv"]));
      assert.equal(r.status, status, `${n} bytes`);
      if (status === 200) assert.equal((await r.text()).length, n);
      else assert.ok(s.logs.some((l) => /getAccountInfo: the answer is over 1000 bytes/.test(l)), s.logs.join("\n"));
    } finally {
      await s.stop();
    }
  }
});

test("an RPC that's down or doesn't answer in time is a 502, and the log says which", async () => {
  const gone = http.createServer();
  const url = await listen(gone); // a port nothing listens on once it's closed
  await close(gone);
  const down = await start({ url });
  try {
    assert.equal((await down.post(call("getEpochInfo"))).status, 502);
    assert.ok(down.logs.some((l) => /getEpochInfo: no answer \(ECONNREFUSED\)/.test(l)), down.logs.join("\n"));
  } finally {
    await down.stop();
  }
  const slow = await start({ answer: () => new Promise(() => {}), timeoutMs: 200 });
  try {
    // the client gives up first if the proxy never does
    assert.equal((await slow.post(call("getEpochInfo"), { signal: AbortSignal.timeout(1_500) })).status, 502);
    assert.ok(slow.logs.some((l) => /getEpochInfo: no answer in 200 ms/.test(l)), slow.logs.join("\n"));
  } finally {
    await slow.stop();
  }
});

test("no other site's page can read it (no CORS on /api/rpc); the other routes keep theirs", async () => {
  const s = await start();
  try {
    const pre = await fetch(`${s.base}/api/rpc`, { method: "OPTIONS", headers: { origin: "https://other.example", "access-control-request-method": "POST" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
    assert.equal(pre.headers.get("access-control-allow-methods"), null);
    for (const body of [call("getEpochInfo"), call("getProgramAccounts", []), { id: 1 }]) {
      assert.equal((await s.post(body, { headers: { origin: "https://other.example" } })).headers.get("access-control-allow-origin"), null, JSON.stringify(body));
    }
    assert.equal((await fetch(`${s.base}/api/ping`)).headers.get("access-control-allow-origin"), "*");
    assert.equal((await fetch(`${s.base}/api/ping`, { method: "OPTIONS" })).headers.get("access-control-allow-origin"), "*");
  } finally {
    await s.stop();
  }
});

test("GET /api/rpc is a 405", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/api/rpc`)).status, 405);
  } finally {
    await s.stop();
  }
});
