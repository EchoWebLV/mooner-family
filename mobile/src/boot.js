// The loading screen's lines (ui/BootLog.js): what the app loads at start, one line each, so
// the screen shows real checks. A line is "wait", "ok" or "fail"; the screen shows each line
// once the one before it is no longer waiting.
import { grouped } from "./ui/format.js";

/** How long the presales feed may take to send its first snapshot before its line fails. */
export const FEED_WAIT_MS = 8_000;
/** How long the screen holds once every line is ok, so the last tick is seen. */
export const HOLD_MS = 700;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The lines from the store's state and the screen's own RPC check.
 *  `rpc`: null while it runs, { ms, slot } or { error }. `feedLate`: FEED_WAIT_MS passed with
 *  no snapshot. */
export function bootLines({ version, info, infoError, rpc, loaded, feedError, presales, feedLate }) {
  const server = info
    ? { state: "ok", text: `mooner v${version} · ${info.cluster}` }
    : infoError
      ? { state: "fail", text: `server · ${infoError}` }
      : { state: "wait", text: `mooner v${version} · connecting` };

  const ping = !rpc
    ? { state: "wait", text: "rpc · checking" }
    : rpc.error
      ? { state: "fail", text: `rpc · ${rpc.error}` }
      : { state: "ok", text: `rpc ok ${rpc.ms} ms` };

  const slot = !rpc
    ? { state: "wait", text: "solana slot · reading" }
    : rpc.error
      ? { state: "fail", text: "solana slot · no rpc" }
      : { state: "ok", text: `solana slot ${grouped(String(rpc.slot))}` };

  let feed;
  if (loaded) {
    const rows = Object.values(presales ?? {});
    const open = rows.filter((p) => p.state === "OPEN").length;
    const launching = rows.filter((p) => p.state === "FULL" || p.state === "LAUNCHING").length;
    feed = { state: "ok", text: `${plural(open, "presale", "presales")} open · ${launching} launching` };
  } else if (feedError) feed = { state: "fail", text: `presales · ${feedError}` };
  else if (feedLate) feed = { state: "fail", text: "presales · live feed not connected" };
  else feed = { state: "wait", text: "presales · loading" };

  return [
    { id: "server", ...server },
    { id: "rpc", ...ping },
    { id: "slot", ...slot },
    { id: "presales", ...feed },
  ];
}

/** The lines the screen shows: each one after the one before it has settled. */
export function shownLines(lines) {
  const out = [];
  for (const l of lines) {
    out.push(l);
    if (l.state === "wait") break;
  }
  return out;
}

/** "ok" when every line is ok, "fail" when one has failed, else "wait". */
export function bootState(lines) {
  if (lines.some((l) => l.state === "fail")) return "fail";
  return lines.every((l) => l.state === "ok") ? "ok" : "wait";
}
