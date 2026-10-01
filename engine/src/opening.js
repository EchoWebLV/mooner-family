// An open tried again with the same coin, after one whose outcome was unknown: if the program
// refuses it because the presale is already there, the first open landed. The program says
// so with its own AlreadyExists (28) before it calls System (presale util.rs create_pda), so
// it is never System's "already in use". The web app and the phone app both ask this here.
// No node: imports.

/** "Program <pid> failed: custom program error: 0x1c": Mooner's AlreadyExists, from its logs. */
const logLine = (pid) => `Program ${pid} failed: custom program error: 0x1c`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `e` says the presale already exists, as program `pid` (base58) raised it:
 *  - the error's name in the message (the server's simulation, or the chain's with logs:
 *    consts.js describeTxError names only Mooner's own codes);
 *  - "(<pid>): custom 28" in the message (the chain's when its logs couldn't be read);
 *  - that line in the logs, on the server's answer (`e.body.logs`) or on a TxError (`e.logs`).
 *  Another program's 28 is something else. */
export function alreadyOpen(e, pid) {
  if (!e) return false;
  const message = typeof e.message === "string" ? e.message : "";
  if (/\bAlreadyExists\b/.test(message)) return true;
  if (!pid) return false;
  const id = String(pid);
  if (new RegExp(`\\(${escape(id)}\\): custom 28(?!\\d)`).test(message)) return true;
  const lines = [e.body?.logs, e.logs].flatMap((l) => (Array.isArray(l) ? l : []));
  return lines.includes(logLine(id));
}
