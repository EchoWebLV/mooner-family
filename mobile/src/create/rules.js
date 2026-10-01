// What the Create screen allows and says: the coin's name, ticker, description and links, the
// creator's commit, the picture, and errors in words. Plain functions (no React Native, so Node
// tests run them). The text rules are the website's (web/src/lib/launch.ts) plus the server's
// byte limits (engine/server/api.js mint), so what the form takes the server takes too.
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../../../engine/src/apiclient.js";
import { explain, sol } from "../../../engine/src/flows.js";
import { alreadyOpen } from "../../../engine/src/opening.js";
import { presalePda } from "../../../engine/src/pdas.js";
import { OUTCOME_UNKNOWN, outcomeUnknown } from "../../../engine/src/tx.js";
import { SEAT_PRESETS } from "../../../engine/src/views.js";
import { solText } from "../ui/format.js";

export const NAME_MAX = 32;
export const TICKER_MIN = 2;
export const TICKER_MAX = 10;
export const DESCRIPTION_MAX = 280;
export const IMAGE_MAX = 2 * 1024 * 1024; // the server's MAX_IMAGE
const NAME_BYTES = 32;
const DESCRIPTION_BYTES = 600;
const LINK_BYTES = 120;
const TOO_BIG = "Too long: emoji and accented letters take more room";

export const LINK_KINDS = ["x", "telegram", "website"];
const LINK_ERRORS = {
  x: "Enter an X link or @handle",
  telegram: "Enter a Telegram link or @handle",
  website: "Enter a web address",
};

/** An empty form. */
export const blankDraft = () => ({ name: "", ticker: "", description: "", links: { x: "", telegram: "", website: "" } });

/** A coin the server already issued, as the form (to open an unopened coin). */
export function draftOf(token) {
  const links = token.links ?? {};
  return {
    name: token.name ?? "",
    ticker: token.symbol ?? "",
    description: token.description ?? "",
    links: { x: links.twitter ?? "", telegram: links.telegram ?? "", website: links.website ?? "" },
  };
}

/** "$moon" → "MOON": capital letters and digits only. */
export const normalizeTicker = (input) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

const encoder = new TextEncoder();
/** Bytes `s` takes as UTF-8: the server's limits are in bytes. */
export const utf8Length = (s) => encoder.encode(s).length;

/** The name as the server takes it: one line, no control characters, single spaces. */
export const cleanName = (s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").trim();

/** The description as the server takes it: lines are fine, tabs become spaces, other control
 *  characters go. */
export const cleanDescription = (s) =>
  s.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();

const HANDLE = /^@?([A-Za-z0-9_]{1,32})$/;
const HANDLE_BASE = { x: "https://x.com/", telegram: "https://t.me/" };
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// https, a dotted host of letters, digits and hyphens (no user, no port), then maybe a path,
// query or fragment without spaces or control characters
const HTTPS = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s\u0000-\u001f\u007f]*)?$/i;

/** The https address a link field means, or null. A bare @handle becomes an X or Telegram
 *  address; a bare domain gets https://. */
export function linkHref(kind, value) {
  const v = value.trim();
  if (!v) return null;
  const handle = HANDLE.exec(v);
  if (handle && HANDLE_BASE[kind]) return HANDLE_BASE[kind] + handle[1];
  const url = SCHEME.test(v) ? v : `https://${v}`;
  return HTTPS.test(url) ? url : null;
}

/** The form's problems by field ({} when there are none). `taken`: tickers in use
 *  (takenTickers). */
export function validate(draft, { taken = new Set() } = {}) {
  const errors = {};
  const name = cleanName(draft.name);
  if (name.length < 2) errors.name = "At least 2 characters";
  else if (name.length > NAME_MAX) errors.name = `At most ${NAME_MAX} characters`;
  else if (utf8Length(name) > NAME_BYTES) errors.name = TOO_BIG;

  const ticker = normalizeTicker(draft.ticker);
  if (ticker.length < TICKER_MIN || ticker.length > TICKER_MAX) errors.ticker = `${TICKER_MIN}–${TICKER_MAX} letters or digits`;
  else if (taken.has(ticker)) errors.ticker = `$${ticker} is taken`;

  const description = cleanDescription(draft.description);
  if (description.length > DESCRIPTION_MAX) errors.description = `At most ${DESCRIPTION_MAX} characters`;
  else if (utf8Length(description) > DESCRIPTION_BYTES) errors.description = TOO_BIG;

  for (const kind of LINK_KINDS) {
    const value = draft.links[kind] ?? "";
    if (!value.trim()) continue;
    const href = linkHref(kind, value);
    if (!href) errors[kind] = LINK_ERRORS[kind];
    else if (utf8Length(href) > LINK_BYTES) errors[kind] = `At most ${LINK_BYTES} characters`;
  }
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;

/** The form as flows.requestMint takes it: links as https addresses, "" when empty. */
export function mintFields(draft) {
  const href = (kind) => linkHref(kind, draft.links[kind] ?? "") ?? "";
  return {
    name: cleanName(draft.name),
    symbol: normalizeTicker(draft.ticker),
    description: cleanDescription(draft.description),
    links: { twitter: href("x"), telegram: href("telegram"), website: href("website") },
  };
}

/** What the creator may commit, in BigInt lamports: { min, max, step }. The co-signer refuses
 *  more than TARGET − MIN_SEAT (cosigner.js), so another seat always fits. */
export function commitBounds(N) {
  const cap = N.TARGET - N.MIN_SEAT;
  return { min: N.MIN_SEAT, max: N.MAX_SEAT < cap ? N.MAX_SEAT : cap, step: N.STEP };
}

/** The commit chips: the seat presets under the most the creator may put in, then that most. */
export function commitChoices(N) {
  const { min, max } = commitBounds(N);
  return [...SEAT_PRESETS.filter((a) => a >= min && a < max), max];
}

/** Why `commit` (BigInt lamports) can't open a presale, or null. */
export function commitProblem(commit, N) {
  const { min, max, step } = commitBounds(N);
  const ok = typeof commit === "bigint" && commit >= min && commit <= max && commit % step === 0n;
  return ok ? null : `Pick ${sol(min)} to ${sol(max)} SOL, so others have room to join.`;
}

/** What the wallet lacks to open, as one line, or null. `extra`: openCost() (BigInt, or null
 *  while it's read); `lamports`: the wallet's SOL (a number, or null while it's read). Unknown
 *  amounts block nothing: the wallet and Solana have the last word. */
export function shortOfOpen(commit, extra, lamports) {
  if (extra == null || lamports == null) return null;
  const have = BigInt(Math.floor(Number(lamports)));
  const need = commit + extra;
  if (need <= have) return null;
  return `You need ${solText(need, 3)} SOL to open this (your commit plus about ${solText(extra, 4)} SOL in fees and rent). You have ${solText(have, 3)}.`;
}

const IN_PLAY = new Set(["OPEN", "FULL", "LAUNCHING", "SETTLED"]);

/** Tickers in use: presales in play and launched coins. One that expired or failed is free. */
export function takenTickers({ presales, launched }) {
  const out = new Set();
  for (const v of Object.values(presales)) if (IN_PLAY.has(v.state) && v.token?.symbol) out.add(v.token.symbol.toUpperCase());
  for (const r of Object.values(launched)) if (r.token?.symbol) out.add(r.token.symbol.toUpperCase());
  return out;
}

/** The wallet's coins that no presale has opened, newest first. `tokens`: GET
 *  /api/wallet/<wallet>/tokens (null before it's read); `presales`: the store's list (an open
 *  can reach the feed before the server's record says so). */
export function unopenedOf(tokens, presales) {
  const opened = new Set(Object.values(presales).map((v) => v.token?.mint).filter(Boolean));
  return (tokens ?? []).filter((t) => !t.presale && !opened.has(t.mint));
}

const OPENER = /can't open presales yet|not on the openers list/;

/** A retry of a coin whose open had landed: the presale program refuses it with its own
 *  AlreadyExists (28) (engine/src/opening.js alreadyOpen), the store's read before the
 *  retry finds the presale on the server (in any state: it may have closed since), or the
 *  feed has it before the wallet is asked. The screen then goes to the room. */
export const ALREADY_OPEN = "This coin's presale was already opened.";

/** The store's read before a retry gave anything but the server's own 404, so it can't tell
 *  whether the presale is there: nothing is signed, and the coin stays saved. */
export const RETRY_UNCHECKED = "Couldn't check whether this coin's presale was already opened. Try again.";

/** The store refuses to open another coin while one is saved for the wallet (its open's
 *  outcome isn't known): only that coin can be tried, or left by Start over. */
export const OPEN_PENDING = "Another coin's open isn't settled yet. Try that coin again first.";

/** The error the server sends with its 404 for a presale it neither has on chain nor
 *  recorded: engine/server/api.js, in onePresale,
 *  `if (!token) throw new HttpError(404, "no such presale");` (http.js sends it as
 *  { error }). Any other 404 (http.js's "not found" for a path no route has, a proxy's) says
 *  nothing about the presale. */
export const NO_SUCH_PRESALE = "no such presale";

/** The one read before a retry. `read()`: GET /api/presale/<key> (apiclient.js presale).
 *  "open": the server knows the presale in any state, so an earlier open landed (it may have
 *  closed since, and the program would then open the same coin again). "retry": the
 *  server's own 404 (NO_SUCH_PRESALE), so it hasn't opened. "unknown": anything else (another
 *  404, a 5xx, a timeout, a network error, no view), so nothing can be told. */
export async function checkBeforeRetry(read) {
  try {
    return (await read()) ? "open" : "unknown";
  } catch (e) {
    return e?.status === 404 && e.body?.error === NO_SUCH_PRESALE ? "retry" : "unknown";
  }
}

// an open's blockhash lasts about 150 blocks (about a minute), so 5 minutes is a wide margin
export const START_OVER_MS = 5 * 60_000;

/** Whether the creator may leave the saved open `record` for a new coin. Yes only when both
 *  hold: `read`, the verdict of the read before the last retry (checkBeforeRetry), was the
 *  server's own 404 ("retry"); and `now`, when that read was asked (ms), is more than
 *  START_OVER_MS after the record's `at`, so its last open can't land any more. The store
 *  sets `at` at each save: before the wallet is asked, once it has signed, and when an
 *  unknown outcome is reported. Anything else is no: "open" or "unknown", a missing or
 *  broken `at`. */
export function canStartOver(record, read, now) {
  const at = record?.at;
  return read === "retry" && Number.isSafeInteger(at) && at > 0 && Number.isFinite(now) && now - at > START_OVER_MS;
}

/** Why a retry's saved `commit` (BigInt lamports, fixed for its mint) can't open under `N`
 *  now, in one line, or null. The screen can't change it; Start over is the way out. */
export function keptCommitProblem(commit, N) {
  if (commitProblem(commit, N) === null) return null;
  const s = sol(commit, 9);
  return commit > commitBounds(N).max ? `${s} SOL is more than a seat can hold now.` : `${s} SOL doesn't fit a seat now.`;
}

/** A create error in words: an open that may have gone out (openFailure), a retry of one
 *  that landed (`pid`: the presale program's key in base58, for alreadyOpen), the store's
 *  own refusals, the server's (engine/server/api.js mint, cosigner.js), the wallet's
 *  Decline, else explain(). */
export function createError(e, pid = null) {
  const m = e?.message ?? String(e);
  if (e?.outcomeUnknown) return OUTCOME_UNKNOWN;
  if (m === ALREADY_OPEN || m === RETRY_UNCHECKED || m === OPEN_PENDING) return m; // the store's own
  if (alreadyOpen(e, pid)) return ALREADY_OPEN;
  if (OPENER.test(m)) return "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale.";
  // Seed Vault's Decline: MWA's ERROR_NOT_SIGNED (-3) or ERROR_AUTHORIZATION_FAILED (-1), with
  // the wallet's own wording (checks.js, useConnect.js)
  if (e?.code === -3 || e?.code === -1) return "You cancelled it in your wallet.";
  if (e?.status === 429 && Array.isArray(e.body?.unopened)) {
    return `${e.body.unopened.length} of your coins aren't open yet. Open one of them first: they're at the top of Create.`;
  }
  if (e?.status === 429) return "Too many tries from here for now. Try again later.";
  if (e?.status === 401) return "The wallet's signature didn't match the coin's details. Try again.";
  if (e?.status === 409) return "That signature was already used. Try again.";
  if (e?.status === 502) return "Couldn't save the picture and details to IPFS. Try again.";
  if (/time must be now/.test(m)) return "Your phone's clock is off. Turn on automatic date and time, then try again.";
  if (/make the launch tx \d+ bytes/.test(m)) return "The name and ticker are too long together. Make the name shorter.";
  return explain(e);
}

/** Whether a failure after the wallet signed the open may have sent it: anything but the
 *  server's refusal (400, 403, 429) or an answer of its own that says `sent: false` (api.js:
 *  from before the send, such as its 503 for a slow simulation), which send nothing. */
export const mayHaveSent = (e) => !(e instanceof ApiError && ([400, 403, 429].includes(e.status) || e.body?.sent === false));

/** An open's failure as the store throws it. `sent`: the wallet had signed. A failure after
 *  that which may have sent the open (a network error, a 5xx without `sent: false`, a
 *  deadline, the presale not seen in time) becomes tx.js outcomeUnknown, never a plain
 *  failure: the screen then retries only the same coin, so no second coin comes of it. An
 *  outcomeUnknown already (the co-signer's, or flows.js waitSent's after a 202) passes as it
 *  is, with its `sig`. */
export function openFailure(e, sent) {
  if (!sent || !mayHaveSent(e)) return e;
  return e?.outcomeUnknown ? e : outcomeUnknown(e?.sig ?? null, "open");
}

/** Whether a store result's words are the unknown outcome. */
export const isUnknown = (error) => error === OUTCOME_UNKNOWN;

/** The key of coin `mint`'s presale (base58), as the chain derives it. */
export const presaleKeyOf = (info, mint) => presalePda(info.pid, new PublicKey(mint)).toBase58();

/** Whether the watched presale `key` has shown up: its pushed snapshot (the store's watch) or
 *  its row in the list. Only a presale the feed has carries a `state`. */
export const openLanded = (key, { views, presales }) => !!key && !!(views[key]?.state || presales[key]?.state);

/** What Back does on step `at`: "stay", "leave" (the tab), "restart" or "previous". `locked`:
 *  an open is running or its outcome is unknown, so the coin stays; `issued`: the server has
 *  the coin, whose details are then fixed. */
export function backAction({ at, locked, issued, step }) {
  if (locked) return "stay";
  if (at === 0) return "leave";
  if (issued && step === "commit") return "restart";
  return "previous";
}

/** Whether `o` is a whole saved open: its mint, presale and ticker, and its commit as a
 *  string of whole lamports. A missing or broken `at` still counts: the coin stays locked,
 *  and canStartOver never lets it go. */
export const isOpening = (o) =>
  !!o && typeof o.mint === "string" && typeof o.presale === "string" && typeof o.symbol === "string" && /^\d+$/.test(String(o.commit ?? ""));

/** The screen's state for `opening`, the store's saved open whose outcome wasn't known ({ mint,
 *  presale, symbol, name, description, links, image, commit, at }), or null: the coin on the
 *  last look, its form and picture, the commit (BigInt), and its presale to watch (`unknown`),
 *  which locks Back and allows only a retry of this coin. */
export function restoredOpen(opening) {
  const o = opening;
  if (!isOpening(o)) return null;
  return {
    step: "review",
    coin: o,
    draft: draftOf(o),
    picture: { uri: o.image ?? null, bytes: null },
    commit: BigInt(o.commit),
    unknown: o.presale,
    error: OUTCOME_UNKNOWN,
  };
}

/** The centred square of a w×h picture, and the side to scale it to (at most `max` px). */
export function squareOf(w, h, max = 1024) {
  const side = Math.min(w, h);
  return {
    crop: { originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side },
    size: Math.min(side, max),
  };
}

// as the server's sniffImage (engine/server/api.js): a JPEG's first three bytes and more, a
// PNG's whole 8-byte signature and more
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b.length > 8 && PNG.every((x, i) => b[i] === x);

/** Why the picture's bytes can't go to the server, or null. */
export function imageProblem(bytes) {
  if (!bytes || bytes.length === 0) return "Pick a picture.";
  if (bytes.length > IMAGE_MAX) return "That picture is over 2 MB. Pick another.";
  if (!isJpeg(bytes) && !isPng(bytes)) return "That picture couldn't be read. Pick another.";
  return null;
}
