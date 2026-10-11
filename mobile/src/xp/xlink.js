// Link X: where the server sends the browser back after X's sign-in page, and what that link
// says. Pure, for Node tests.

/** The app's link the server's /api/x/callback goes to (engine/server/xlink.js X_BACK). */
export const X_BACK = "mooner://x-link";

/** True for a link X sent back (`url` as the system hands it over, query and all). */
export const isXBack = (url) => typeof url === "string" && (url === X_BACK || url.startsWith(`${X_BACK}?`) || url.startsWith(`${X_BACK}/`));

/** What a link X sent back says: { handle } (linked), { error } (the server's words), or null
 *  (none, or not that link). Read by hand: React Native's URLSearchParams has no get(). */
export function xBackOf(url) {
  if (!isXBack(url)) return null;
  const q = {};
  for (const part of url.slice(url.indexOf("?") + 1 || url.length).split("&")) {
    const [k, v = ""] = part.split("=");
    try {
      if (k) q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      // a bad escape: that part says nothing
    }
  }
  if (q.handle) return { handle: q.handle };
  if (q.error) return { error: q.error };
  return null;
}
