// Android App Links (spec "Server additions"): /.well-known/assetlinks.json names the signing
// keys whose family.mooner.app may open app.mooner.family links. Android reads it after the
// app is installed; once it checks out, those links open the app instead of the browser
// (developer.android.com/training/app-links/configure-assetlinks). The keys come from
// MOONER_ANDROID_CERTS (config.js); with none set there's no file, and links open the site.

import { HttpError } from "./http.js";

export const ANDROID_PACKAGE = "family.mooner.app";

/** The statement list for `certs` (SHA-256 fingerprints, "AB:CD:…"). */
export function assetLinks(certs, pkg = ANDROID_PACKAGE) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: certs },
    },
  ];
}

/** GET /.well-known/assetlinks.json as plain application/json (Android's docs ask for that
 *  type); 404 while no key is set. */
export function makeAppLinkRoutes({ certs = [] } = {}) {
  return [
    {
      method: "GET",
      path: /^\/\.well-known\/assetlinks\.json$/,
      handler: async () => {
        if (certs.length === 0) throw new HttpError(404, "not found");
        return { json: assetLinks(certs), type: "application/json" };
      },
    },
  ];
}

/** The lines main.js logs about MOONER_ANDROID_CERTS before its checks (so --check shows them
 *  too). A left-out word goes only as its length and first 4 characters: someone may paste
 *  a secret into the variable by mistake, and it mustn't land in the host's logs. */
export function appLinksLog({ androidCerts, androidCertsBad }) {
  const lines = [androidCerts.length ? `App Links for ${androidCerts.length} Android signing key(s)` : "no MOONER_ANDROID_CERTS: no assetlinks.json, app links open the site"];
  const hint = (w) => `${w.length} chars "${w.slice(0, 4)}…"`;
  if (androidCertsBad.length) lines.push(`MOONER_ANDROID_CERTS: ${androidCertsBad.length} word(s) left out (not a SHA-256 fingerprint, or Expo's public debug key): ${androidCertsBad.map(hint).join(", ")}`);
  return lines;
}
