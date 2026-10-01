// Create's rules (src/create/rules.js), an open whose outcome isn't known, and the new
// presale's share words (src/create/share.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../../engine/src/apiclient.js";
import { OUTCOME_UNKNOWN, outcomeUnknown } from "../../engine/src/tx.js";
import {
  ALREADY_OPEN, NO_SUCH_PRESALE, OPEN_PENDING, RETRY_UNCHECKED, START_OVER_MS, backAction, blankDraft, canStartOver, checkBeforeRetry,
  cleanDescription, cleanName, commitBounds, commitChoices, commitProblem, createError, draftOf, hasErrors, imageProblem, isOpening,
  isUnknown, keptCommitProblem, linkHref, mayHaveSent, mintFields, normalizeTicker, openFailure, openLanded, presaleKeyOf,
  restoredOpen, shortOfOpen, squareOf, takenTickers, unopenedOf, utf8Length, validate,
} from "../src/create/rules.js";
import { newPresaleShare } from "../src/create/share.js";

const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const BIG = { TARGET: 10_000_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 1_000_000_000n, STEP: 10_000_000n };
const draft = (over = {}) => ({ ...blankDraft(), name: "Moon Dog", ticker: "MDOG", ...over, links: { ...blankDraft().links, ...over.links } });
const PID = "6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa"; // the presale program (mainnet)
// a saved open's coin and presale: two keys made for these tests, no one's
const MINT = "CtqGFBa6JYHvjp52W1oJ3r2ZoTYidPDbAmKbyU68oTWk";
const PRE = "FjwDw8HvJEXrkmwwzZkNfKW4C6hGgCpMVvDvuhwDxwu2";
const OPENER = "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale.";

test("normalizeTicker: capital letters and digits only", () => {
  assert.equal(normalizeTicker("$moon"), "MOON");
  assert.equal(normalizeTicker("m00n dog!"), "M00NDOG");
  assert.equal(normalizeTicker("ñ"), "");
});

test("utf8Length: bytes, as the server counts them", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length("€"), 3);
  assert.equal(utf8Length("🚀"), 4);
});

test("cleanName and cleanDescription: what the server accepts", () => {
  assert.equal(cleanName("  Moon\tDog\n "), "Moon Dog");
  assert.equal(cleanName("Moon   Dog"), "Moon Dog");
  assert.equal(cleanDescription(" one\r\ntwo\rthree\tfour\u0007 "), "one\ntwo\nthree four");
});

test("linkHref: handles, bare domains and https links; nothing else", () => {
  assert.equal(linkHref("x", "@moondog"), "https://x.com/moondog");
  assert.equal(linkHref("x", "moondog"), "https://x.com/moondog");
  assert.equal(linkHref("telegram", "@moon_dog"), "https://t.me/moon_dog");
  assert.equal(linkHref("website", "moondog.xyz"), "https://moondog.xyz");
  assert.equal(linkHref("website", "https://moondog.xyz/about?a=1#top"), "https://moondog.xyz/about?a=1#top");
  assert.equal(linkHref("x", " x.com/moondog "), "https://x.com/moondog");
  assert.equal(linkHref("website", "  "), null);
  const bad = ["moondog", "@moondog", "http://moondog.xyz", "ftp://moondog.xyz", "https://user@moondog.xyz", "https://moondog.xyz:8080", "localhost:3000", "https://moon dog.xyz", "javascript:alert(1)"];
  for (const v of bad) assert.equal(linkHref("website", v), null, v);
  // the server takes a link when Node's new URL parses it as https (engine/server/api.js parseLinks)
  const serverTakes = (href) => {
    try {
      return new URL(href).protocol === "https:";
    } catch {
      return false;
    }
  };
  for (const host of ["999.1", "999.10", "1.2.3.400", "1.2.3.4.5", "xn--a.com"]) {
    assert.equal(serverTakes(`https://${host}`), false, `the server refuses ${host}`);
    assert.equal(linkHref("website", host), null, host);
  }
  for (const host of ["moondog.xyz", "app.moondog.xyz", "MoonDog.XYZ"]) {
    const href = linkHref("website", host);
    assert.equal(href, `https://${host}`, host);
    assert.equal(serverTakes(href), true, `the server takes ${host}`);
  }
});

test("validate: name, ticker, description and links", () => {
  assert.deepEqual(validate(draft()), {});
  assert.equal(validate(draft({ name: " M " })).name, "At least 2 characters");
  assert.equal(validate(draft({ name: "M".repeat(33) })).name, "At most 32 characters");
  assert.equal(validate(draft({ name: "é".repeat(17) })).name, "Too long: emoji and accented letters take more room");
  assert.equal(validate(draft({ ticker: "M" })).ticker, "2–10 letters or digits");
  assert.equal(validate(draft({ ticker: "ABCDEFGHIJK" })).ticker, "2–10 letters or digits");
  assert.equal(validate(draft({ ticker: "mdog" }), { taken: new Set(["MDOG"]) }).ticker, "$MDOG is taken");
  assert.equal(validate(draft({ description: "a".repeat(281) })).description, "At most 280 characters");
  assert.equal(validate(draft({ description: "€".repeat(201) })).description, "Too long: emoji and accented letters take more room");
  assert.deepEqual(validate(draft({ links: { x: "http://x.com/a", telegram: "@", website: "moondog" } })), {
    x: "Enter an X link or @handle",
    telegram: "Enter a Telegram link or @handle",
    website: "Enter a web address",
  });
  assert.equal(validate(draft({ links: { website: `moondog.xyz/${"a".repeat(120)}` } })).website, "At most 120 characters");
  assert.equal(hasErrors({}), false);
  assert.equal(hasErrors({ name: "At least 2 characters" }), true);
});

test("mintFields: what the wallet signs and the server stores", () => {
  const d = draft({ name: " Moon  Dog ", ticker: "$mdog", description: " hi\r\nthere ", links: { x: "@moondog", website: "moondog.xyz" } });
  assert.deepEqual(mintFields(d), {
    name: "Moon Dog",
    symbol: "MDOG",
    description: "hi\nthere",
    links: { twitter: "https://x.com/moondog", telegram: "", website: "https://moondog.xyz" },
  });
});

test("draftOf: an issued coin back as the form, and the same fields again", () => {
  const token = { mint: "M1", name: "Moon Dog", symbol: "MDOG", description: "hi", links: { twitter: "https://x.com/moondog" }, presale: null };
  const d = draftOf(token);
  assert.deepEqual(d, { name: "Moon Dog", ticker: "MDOG", description: "hi", links: { x: "https://x.com/moondog", telegram: "", website: "" } });
  assert.deepEqual(mintFields(d).links, { twitter: "https://x.com/moondog", telegram: "", website: "" });
});

test("commit: at most TARGET − MIN_SEAT, so another seat fits", () => {
  assert.deepEqual(commitBounds(N), { min: 100_000_000n, max: 400_000_000n, step: 10_000_000n });
  assert.deepEqual(commitChoices(N), [100_000_000n, 250_000_000n, 400_000_000n]);
  assert.deepEqual(commitChoices(BIG), [100_000_000n, 250_000_000n, 500_000_000n, 1_000_000_000n]);
  assert.equal(commitProblem(100_000_000n, N), null);
  assert.equal(commitProblem(400_000_000n, N), null);
  for (const bad of [90_000_000n, 410_000_000n, 500_000_000n, 105_000_000n, 100_000_000]) {
    assert.equal(commitProblem(bad, N), "Pick 0.1 to 0.4 SOL, so others have room to join.", String(bad));
  }
});

test("shortOfOpen: the commit plus fees and rent against the wallet", () => {
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, 200_000_000), null);
  assert.equal(shortOfOpen(100_000_000n, null, 1), null); // cost not read yet
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, null), null); // wallet not read yet
  assert.equal(
    shortOfOpen(100_000_000n, 8_800_000n, 100_000_000),
    "You need 0.109 SOL to open this (your commit plus about 0.0088 SOL in fees and rent). You have 0.1.",
  );
  // a balance reply without `lamports` (apiclient.js balance: Number(undefined)) is not read
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, Number.NaN), null);
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, Number.POSITIVE_INFINITY), null);
});

test("takenTickers: presales in play and launched coins; an expired one's is free", () => {
  const presales = {
    A: { presale: "A", state: "OPEN", token: { symbol: "MDOG" } },
    B: { presale: "B", state: "EXPIRED", token: { symbol: "OLD" } },
    C: { presale: "C", state: "FULL", token: { symbol: "cat" } },
    D: { presale: "D", state: "OPEN", token: null },
    F: { presale: "F", state: "LAUNCHING", token: { symbol: "FOX" } },
    G: { presale: "G", state: "SETTLED", token: { symbol: "GNU" } },
  };
  const launched = { E: { presale: "E", token: { symbol: "PUP" } } };
  assert.deepEqual([...takenTickers({ presales, launched })].sort(), ["CAT", "FOX", "GNU", "MDOG", "PUP"]);
});

test("unopenedOf: the wallet's coins no presale has opened", () => {
  const tokens = [{ mint: "M1", presale: null }, { mint: "M2", presale: "P2" }, { mint: "M3", presale: null }];
  const presales = { P3: { presale: "P3", token: { mint: "M3" } } };
  assert.deepEqual(unopenedOf(tokens, presales).map((t) => t.mint), ["M1"]);
  assert.deepEqual(unopenedOf(null, {}), []);
});

test("createError: the server's and the wallet's refusals in plain words", () => {
  assert.equal(createError(new ApiError(403, "this wallet can't open presales yet (closed beta)", {})), OPENER);
  assert.equal(createError(new ApiError(403, "wallet not on the openers list", {})), OPENER);
  assert.equal(createError(Object.assign(new Error("transaction not signed"), { code: -3 })), "You cancelled it in your wallet.");
  assert.equal(createError(Object.assign(new Error("authorization failed"), { code: -1 })), "You cancelled it in your wallet.");
  assert.equal(createError(new Error("User rejected the request")), "You cancelled it in your wallet.");
  assert.equal(
    createError(new ApiError(429, "3 of your tokens aren't opened yet; open one of them first", { unopened: ["A", "B", "C"] })),
    "3 of your coins aren't open yet. Open one of them first: they're at the top of Create.",
  );
  assert.equal(createError(new ApiError(429, "too many token requests from this wallet, try again later", {})), "Too many tries from here for now. Try again later.");
  assert.equal(createError(new ApiError(401, "the signature doesn't match this wallet and these details", {})), "The wallet's signature didn't match the coin's details. Try again.");
  assert.equal(createError(new ApiError(409, "this signed request was already used", {})), "That signature was already used. Try again.");
  assert.equal(createError(new ApiError(502, "IPFS: pin failed; try again", {})), "Couldn't save the picture and details to IPFS. Try again.");
  // only the mint's own 502 (api.js: `IPFS: …; try again`) is about IPFS; a proxy's 502 is not
  assert.equal(createError(new ApiError(502, "the server said 502", null)), "the server said 502");
  assert.equal(createError(new ApiError(502, "bad gateway", { error: "bad gateway" })), "bad gateway");
  assert.equal(createError(new ApiError(400, "time must be now, in unix seconds", {})), "Your phone's clock is off. Turn on automatic date and time, then try again.");
  assert.equal(
    createError(new ApiError(400, "the name, symbol and link make the launch tx 1240 bytes (max 1232)", {})),
    "The name and ticker are too long together. Make the name shorter.",
  );
  assert.equal(createError(new ApiError(403, "the creator can put in at most 0.4 SOL, so others can join", {})), "the creator can put in at most 0.4 SOL, so others can join");
  assert.equal(createError(outcomeUnknown("SIG", "open")), OUTCOME_UNKNOWN);
  // a second presale for the mint: the program's own AlreadyExists (28), never System's "already in use"
  const logs = [`Program ${PID} invoke [1]`, `Program ${PID} failed: custom program error: 0x1c`];
  const simulated = new ApiError(400, "the tx fails: ix 1: AlreadyExists (28)", { error: "the tx fails: ix 1: AlreadyExists (28)", logs, sent: false });
  assert.equal(createError(simulated, PID), ALREADY_OPEN, "the server's simulation");
  const raced = new ApiError(400, "open (SIG): ix 1: AlreadyExists (28)", { error: "open (SIG): ix 1: AlreadyExists (28)", sig: "SIG", logs });
  assert.equal(createError(raced, PID), ALREADY_OPEN, "two opens raced: the send's own 400");
  const bare = new ApiError(400, `open (SIG): ix 1 (${PID}): custom 28`, { sig: "SIG", logs: [] });
  assert.equal(createError(bare, PID), ALREADY_OPEN, "no logs: the code and who raised it");
  const other = new ApiError(400, "the tx fails: ix 1 (11111111111111111111111111111111): custom 28", { logs: [], sent: false });
  assert.notEqual(createError(other, PID), ALREADY_OPEN, "another program's 28");
  const system = new ApiError(400, "the tx fails: ix 2 (11111111111111111111111111111111): custom 0", {
    logs: ["Allocate: account Address { address: Pre1, base: None } already in use"],
  });
  assert.notEqual(createError(system, PID), ALREADY_OPEN, "System's own words aren't the program's refusal");
  assert.equal(createError(new Error(ALREADY_OPEN)), ALREADY_OPEN, "the store's read before a retry");
  assert.equal(ALREADY_OPEN, "This coin's presale was already opened.", "true for a presale that closed since too");
  assert.equal(createError(new Error(RETRY_UNCHECKED)), RETRY_UNCHECKED);
  assert.equal(createError(new Error(OPEN_PENDING)), OPEN_PENDING, "the store refuses another coin while one is saved");
  assert.equal(
    createError(new ApiError(400, "the tx fails: Transaction results in an account (0) with insufficient funds for rent", { logs: [] })),
    "Your wallet needs a little more SOL to cover rent and the Solana fee.",
  );
});

test("openFailure: after the wallet signed, anything but the server's refusal is an unknown outcome", () => {
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s"), { timedOut: true });
  const unknown = [
    new TypeError("Network request failed"),
    new ApiError(502, "bad gateway", {}),
    late,
    new Error("the presale didn't show up yet; refresh in a moment"),
  ];
  for (const e of unknown) {
    assert.equal(mayHaveSent(e), true, e.message);
    const out = openFailure(e, true);
    assert.equal(out.outcomeUnknown, true, e.message);
    assert.equal(out.message, OUTCOME_UNKNOWN, e.message);
  }
  const cosign = outcomeUnknown("SIG", "cosign");
  assert.equal(openFailure(cosign, true), cosign, "the co-signer's own unknown passes as it is");
  const waited = outcomeUnknown("SIG", "open");
  assert.equal(openFailure(waited, true), waited, "the wait after a 202 ended (flows.js waitSent, since 6b9bbfe): as it is");
  assert.equal(openFailure(waited, true).sig, "SIG");
  for (const status of [400, 403, 429]) {
    const e = new ApiError(status, "refused", {});
    assert.equal(mayHaveSent(e), false, String(status));
    assert.equal(openFailure(e, true), e, `a ${status}: the server sent nothing`);
  }
  // http.js's own 4xx from before a route runs (no route, wrong method, a body too big): not
  // the server's refusal, so the safe side
  for (const status of [404, 405, 413]) {
    const e = new ApiError(status, "refused", {});
    assert.equal(mayHaveSent(e), true, String(status));
    assert.equal(openFailure(e, true).outcomeUnknown, true, String(status));
  }
  const slow = new ApiError(503, "the network is slow, try again", { error: "the network is slow, try again", sent: false });
  assert.equal(mayHaveSent(slow), false, "an answer from before the send says sent: false");
  assert.equal(openFailure(slow, true), slow, "a 503 with sent: false: the server sent nothing");
  const before = new TypeError("Network request failed");
  assert.equal(openFailure(before, false), before, "before the wallet signed, nothing can have gone out");
  assert.equal(isUnknown(OUTCOME_UNKNOWN), true);
  assert.equal(isUnknown("You cancelled it in your wallet."), false);
});

test("presaleKeyOf: the presale's key from the program and the mint, as the chain derives it", () => {
  const info = { pid: new PublicKey("6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa") };
  assert.equal(presaleKeyOf(info, "So11111111111111111111111111111111111111112"), "9BatUyfhMsGHAQ5PpR9CT5C5tGzrbppmZkkCu29onKWz");
});

test("backAction: nothing while an open runs or its outcome is unknown; else a step back, or a fresh start from an issued coin's commit", () => {
  assert.equal(backAction({ at: 0, locked: false, issued: false, step: "picture" }), "leave");
  assert.equal(backAction({ at: 1, locked: false, issued: false, step: "details" }), "previous");
  assert.equal(backAction({ at: 2, locked: false, issued: true, step: "commit" }), "restart");
  assert.equal(backAction({ at: 3, locked: false, issued: true, step: "review" }), "previous");
  assert.equal(backAction({ at: 3, locked: true, issued: true, step: "review" }), "stay");
  assert.equal(backAction({ at: 0, locked: true, issued: false, step: "picture" }), "stay", "locked wins, even on the first step");
});

test("openLanded: the watched presale's snapshot or its row in the list means the open landed", () => {
  const view = { presale: "Pre1", state: "OPEN" };
  assert.equal(openLanded(null, { views: { Pre1: view }, presales: {} }), false, "nothing watched");
  assert.equal(openLanded("Pre1", { views: {}, presales: {} }), false);
  assert.equal(openLanded("Pre1", { views: { Pre1: null }, presales: {} }), false, "no state: not there yet");
  assert.equal(openLanded("Pre1", { views: { Pre1: view }, presales: {} }), true, "a presale snapshot");
  assert.equal(openLanded("Pre1", { views: {}, presales: { Pre1: view } }), true, "the list has it");
});

test("restoredOpen: a saved open whose outcome wasn't known comes back on the last look, locked to its coin", () => {
  assert.equal(restoredOpen(null), null);
  assert.equal(restoredOpen(undefined), null);
  assert.equal(restoredOpen({ mint: MINT, presale: PRE }), null, "not a whole record");
  const saved = {
    mint: MINT,
    presale: PRE,
    name: "Moon Dog",
    symbol: "MDOG",
    description: "",
    links: { twitter: "https://x.com/moondog", telegram: "", website: "" },
    image: "https://gw/ipfs/img",
    commit: "100000000",
    at: 1_790_000_000_000,
  };
  assert.equal(isOpening(saved), true);
  assert.equal(isOpening({ ...saved, commit: "0.1" }), false, "the commit is whole lamports");
  assert.equal(isOpening({ ...saved, commit: "0" }), false, "a commit of more than 0");
  assert.equal(isOpening({ ...saved, symbol: "" }), false, "a ticker");
  assert.equal(isOpening({ ...saved, symbol: " " }), false, "a ticker, not blanks");
  assert.equal(restoredOpen({ ...saved, commit: "0" }), null);
  assert.equal(isOpening({ ...saved, at: undefined }), true, "a missing at still locks; canStartOver never lets it go");
  const r = restoredOpen(saved);
  assert.equal(r.step, "review");
  assert.equal(r.coin, saved);
  assert.equal(r.unknown, PRE, "its presale is watched");
  assert.equal(r.commit, 100_000_000n);
  assert.deepEqual(r.picture, { uri: "https://gw/ipfs/img", bytes: null });
  assert.deepEqual(r.draft, draftOf(saved));
  assert.equal(r.error, OUTCOME_UNKNOWN);
  // the screen's last look is step 3; an unknown outcome locks it, so Back stays put
  assert.equal(backAction({ at: 3, locked: !!r.unknown, issued: !!r.coin, step: r.step }), "stay");
});

test("isOpening: a saved open's mint and presale are public keys in base58", () => {
  const saved = { mint: MINT, presale: PRE, symbol: "MDOG", commit: "100000000", at: 1_790_000_000_000 };
  assert.equal(isOpening(saved), true);
  assert.equal(isOpening({ ...saved, mint: "Mint1" }), false, "a mint that isn't a key");
  assert.equal(isOpening({ ...saved, presale: "Pre1" }), false, "a presale that isn't a key");
  // a key's shape (base58, 32–44 characters), but 24 bytes, not 32: new PublicKey throws
  const short = "z".repeat(32);
  assert.equal(isOpening({ ...saved, mint: short }), false, "a mint of 32 characters that isn't 32 bytes");
  assert.equal(isOpening({ ...saved, presale: short }), false, "a presale of 32 characters that isn't 32 bytes");
  assert.equal(restoredOpen({ ...saved, mint: "Mint1" }), null, "nothing to restore");
});

/** A read before a retry (GET /api/presale) that throws `e`. */
const failsWith = (e) => async () => {
  throw e;
};
/** The server's own 404 (engine/server/api.js onePresale), as apiclient.js throws it. */
const GONE = new ApiError(404, "no such presale", { error: "no such presale" });

test("checkBeforeRetry: a presale the server knows is open; only its own 404 lets a retry go on; anything else can't tell", async () => {
  assert.equal(NO_SUCH_PRESALE, "no such presale", "api.js onePresale: if (!token) throw new HttpError(404, \"no such presale\");");
  assert.equal(await checkBeforeRetry(async () => ({ presale: "Pre1", state: "OPEN", seats: [] })), "open");
  assert.equal(await checkBeforeRetry(async () => ({ presale: "Pre1", where: "closed", state: "CLOSED", seats: [] })), "open", "closed since");
  assert.equal(await checkBeforeRetry(failsWith(GONE)), "retry");
  assert.equal(await checkBeforeRetry(failsWith(new ApiError(404, "not found", { error: "not found" }))), "unknown", "http.js's 404 for a path no route has");
  assert.equal(await checkBeforeRetry(failsWith(new ApiError(404, "the server said 404", null))), "unknown", "a proxy's 404 that isn't JSON");
  assert.equal(await checkBeforeRetry(failsWith(new ApiError(502, "bad gateway", {}))), "unknown");
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s", null), { timedOut: true });
  assert.equal(await checkBeforeRetry(failsWith(late)), "unknown");
  assert.equal(await checkBeforeRetry(failsWith(new TypeError("Network request failed"))), "unknown");
  assert.equal(await checkBeforeRetry(async () => null), "unknown", "no view: can't tell");
});

test("canStartOver: the server's own 404, asked more than START_OVER_MS after the coin was last saved; nothing else", async () => {
  const NOW = 1_790_000_000_000;
  const saved = (at) => ({ mint: "Mint1", presale: "Pre1", symbol: "MDOG", commit: "100000000", at });
  const old = saved(NOW - START_OVER_MS - 1);
  assert.equal(START_OVER_MS, 300_000);
  assert.equal(canStartOver(old, await checkBeforeRetry(failsWith(GONE)), NOW), true, "404 and old");
  assert.equal(canStartOver(saved(NOW - 60_000), await checkBeforeRetry(failsWith(GONE)), NOW), false, "404 and new: its open may still land");
  assert.equal(canStartOver(saved(NOW - START_OVER_MS), "retry", NOW), false, "exactly START_OVER_MS is not more");
  const reads = [
    [async () => ({ presale: "Pre1", state: "OPEN", seats: [] }), "a 200"],
    [failsWith(new ApiError(502, "bad gateway", {})), "a 5xx"],
    [failsWith(new TypeError("Network request failed")), "a read that threw"],
    [failsWith(new ApiError(404, "not found", { error: "not found" })), "another 404"],
  ];
  for (const [read, why] of reads) assert.equal(canStartOver(old, await checkBeforeRetry(read), NOW), false, why);
  for (const at of [undefined, null, "1000", 0, -5, 1.5, Number.NaN]) {
    assert.equal(canStartOver(saved(at), "retry", NOW), false, `at: ${String(at)}`);
  }
  assert.equal(canStartOver(null, "retry", NOW), false, "no record");
});

test("keptCommitProblem: a retry's saved commit against the presale numbers now, in one line", () => {
  assert.equal(keptCommitProblem(100_000_000n, N), null);
  assert.equal(keptCommitProblem(400_000_000n, N), null);
  assert.equal(keptCommitProblem(450_000_000n, N), "0.45 SOL is more than a seat can hold now.");
  assert.equal(keptCommitProblem(300_000_000n, { ...N, TARGET: 350_000_000n }), "0.3 SOL is more than a seat can hold now.");
  assert.equal(keptCommitProblem(105_000_000n, N), "0.105 SOL doesn't fit a seat now.");
  assert.equal(keptCommitProblem(90_000_000n, N), "0.09 SOL doesn't fit a seat now.");
});

test("squareOf: the centred square, at most 1024 px", () => {
  assert.deepEqual(squareOf(3000, 4000), { crop: { originX: 0, originY: 500, width: 3000, height: 3000 }, size: 1024 });
  assert.deepEqual(squareOf(801, 600), { crop: { originX: 100, originY: 0, width: 600, height: 600 }, size: 600 });
});

test("imageProblem: a JPEG or PNG of at most 2 MB", () => {
  const jpeg = (n) => {
    const b = new Uint8Array(n);
    b.set([0xff, 0xd8, 0xff]);
    return b;
  };
  const UNREAD = "That picture couldn't be read. Pick another.";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.equal(imageProblem(jpeg(1000)), null);
  assert.equal(imageProblem(Uint8Array.from([...png, 0])), null);
  assert.equal(imageProblem(new Uint8Array(0)), "Pick a picture.");
  assert.equal(imageProblem(null), "Pick a picture.");
  assert.equal(imageProblem(jpeg(2 * 1024 * 1024 + 1)), "That picture is over 2 MB. Pick another.");
  assert.equal(imageProblem(Uint8Array.from([1, 2, 3, 4])), UNREAD);
  // as the server's sniffImage: a PNG needs more than its 8-byte signature, all of it; a JPEG more than 3 bytes
  assert.equal(imageProblem(Uint8Array.from(png)), UNREAD, "the PNG signature alone");
  assert.equal(imageProblem(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])), UNREAD, "half a PNG signature");
  assert.equal(imageProblem(jpeg(3)), UNREAD, "a JPEG's three bytes alone");
  assert.equal(imageProblem(jpeg(4)), null);
});

test("newPresaleShare: piece 3's share words for the creator, the commit as what's in, the wallet as ref", () => {
  const W = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
  const s = newPresaleShare({ key: "Pre1", symbol: "MDOG", wallet: W, commit: 100_000_000n, N: { ...N, DURATION: 3600 }, now: 1_790_000_000_000 });
  assert.deepEqual(s, {
    title: "$MDOG on Mooner",
    message: `My $MDOG presale is open on Mooner.\n0.1 of 0.5 SOL in so far.\nhttps://app.mooner.family/presale/Pre1?ref=${W}`,
  });
});
