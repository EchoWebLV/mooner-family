// The waitlist's sign-up, built into site/assets/join/ by site/tools/build-join.mjs. Privy
// proves the email (a code) and the X account (X login) and makes a Solana wallet; then
// /api/join puts the person on the list and answers how many NFTs they have reserved.
// main.js loads this on the first join click, or when X sends the person back.
import "./polyfills.js"; // first: Buffer before Privy's code runs
import { PrivyProvider, useLinkAccount, useLogin, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

// Mooner's own Privy app ("mooner" on dashboard.privy.io; public). Not the web app's (web/.env):
// the wallet made here is this app's, and the server's PRIVY_APP_ID must be this id
const APP_ID = "cmuzbmcxn01nu0ci75ogggijf";
const CONFIG = {
  loginMethods: ["email", "twitter"],
  appearance: { theme: "dark", accentColor: "#5468ff", logo: "/assets/mooner.svg", landingHeader: "Join the Mooner waitlist", walletChainType: "solana-only" },
  embeddedWallets: { solana: { createOnLogin: "users-without-wallets" }, ethereum: { createOnLogin: "off" } },
};
// Privy's error codes, in the page's words
const SAY = {
  exited_auth_flow: "sign-in closed. try again?",
  exited_link_flow: "sign-in closed. try again?",
  oauth_user_denied: "X login was cancelled. try again?",
  linked_to_another_user: "that email or X already has a Mooner sign-in. join again and sign in with it",
  account_transfer_required: "that email or X already has a Mooner sign-in. join again and sign in with it",
  disallowed_plus_email: "use your email without a +tag",
  too_many_requests: "too many tries. wait a few minutes",
  disallowed_login_method: "X login is off right now. try again later",
};
// the person closed the modal; any other code is shown inside it, and the person can retry there
const EXITS = new Set(["exited_auth_flow", "exited_link_flow"]);
const AGAIN = "sign-in didn't finish. try again?";
const RESTART = new Set(["linked_to_another_user", "account_transfer_required", "http_401"]);
const KEY = "mooner-join"; // sessionStorage: the ?r= ref, kept across the trip to X

const shown = (text, code = null) => Object.assign(new Error(text), { shown: text, code });
const keep = (ref) => {
  try {
    if (ref) sessionStorage.setItem(KEY, ref);
    else sessionStorage.removeItem(KEY);
  } catch {}
};
const kept = () => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const live = {}; // Privy's latest state and calls, refreshed on every render
let wake = () => {}; // the next render wakes whoever waits in until()
// an error with no modal of ours open: X's answer, as Privy finishes a link or login on the way back
let stray = null;
const idle = (code) => {
  if (code) stray = code;
};
let settle = idle; // the Privy modal in flight: settle(null) done, settle(code) a Privy error code
let flight = null; // the sign-up running now: a second join or resume gets it, never a second run

function Bridge() {
  const privy = usePrivy();
  const { login } = useLogin({ onComplete: () => settle(null), onError: (code) => settle(code) });
  const { linkEmail, linkTwitter } = useLinkAccount({ onSuccess: () => settle(null), onError: (code) => settle(code) });
  const { createWallet } = useCreateWallet();
  Object.assign(live, privy, { login, linkEmail, linkTwitter, createWallet });
  useEffect(() => {
    wake();
  });
  return null;
}

let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const el = document.createElement("div");
  document.body.append(el);
  createRoot(el).render(createElement(PrivyProvider, { appId: APP_ID, config: CONFIG }, createElement(Bridge)));
}

/** Waits, render by render, until pred() holds; false once `ms` pass. */
async function until(pred, ms = 20_000) {
  const end = Date.now() + ms;
  while (!pred()) {
    const left = end - Date.now();
    if (left <= 0) return false;
    await new Promise((r) => {
      const t = setTimeout(r, left);
      wake = () => {
        clearTimeout(t);
        r();
      };
    });
  }
  return true;
}

/** Opens a Privy modal (or redirect) and waits until it succeeds or the person closes it. */
function modal(open) {
  return new Promise((resolve, reject) => {
    let last = null; // an error Privy showed in the modal (a wrong code…), said once it closes
    const end = (err) => {
      settle = idle;
      if (err) reject(err);
      else resolve();
    };
    settle = (code) => {
      if (!code) end();
      else if (EXITS.has(code)) end(shown(SAY[last] ?? SAY[code], last ?? code));
      else last = code;
    };
    // linkTwitter is async and can fail before Privy calls back (no authorization url)
    Promise.resolve()
      .then(open)
      .catch((e) => end(shown(SAY[e?.privyErrorCode] ?? AGAIN, e?.privyErrorCode)));
  });
}

// Privy's own wallet: "privy" or "privy-v2" (as the SDK and web's TopBar.tsx check), made in
// the browser ("embedded", not imported), as the server checks
const hasPrivyWallet = (u) =>
  !!u?.linkedAccounts?.some(
    (a) => a.type === "wallet" && a.chainType === "solana" && (a.walletClientType === "privy" || a.walletClientType === "privy-v2") && a.connectorType === "embedded",
  );

async function run({ email, endpoint, onStep, fromX }) {
  stray = null;
  mount();
  if (!(await until(() => live.ready))) throw shown("sign-in didn't load. try again?");
  // this browser is signed in as someone else: sign them out. A session with no email is
  // this person part-way through (X first), so it stays
  const had = live.authenticated && live.user?.email?.address;
  if (email && had && had.toLowerCase() !== email.toLowerCase()) {
    await live.logout();
    if (!(await until(() => !live.authenticated))) throw shown(AGAIN);
  }
  if (!live.authenticated) {
    // back from X with no session: the X trip failed, or came back in another browser
    if (fromX) throw shown(SAY[stray] ?? "sign-in didn't finish. join again?", stray);
    onStep("continue in the sign-in window");
    // email, filled in, or X (which leaves the page; resume() carries on and links the email)
    await modal(() => live.login(email ? { prefill: { type: "email", value: email } } : undefined));
    if (!(await until(() => live.user))) throw shown(AGAIN);
  }
  if (!live.user?.email) {
    onStep("verify your email");
    await modal(() => live.linkEmail());
    if (!(await until(() => live.user?.email))) throw shown(AGAIN);
  }
  if (!live.user?.twitter) {
    if (fromX) {
      // back from X, Privy may still be finishing the link: wait for it, never send them again
      await until(() => live.user?.twitter || stray, 10_000);
      if (!live.user?.twitter) throw shown(SAY[stray] ?? "X login didn't finish. try again?", stray);
    } else {
      onStep("now log in with X");
      await modal(() => live.linkTwitter()); // usually leaves the page; resume() carries on
      if (!(await until(() => live.user?.twitter))) throw shown("X login didn't finish. try again?");
    }
  }
  if (!hasPrivyWallet(live.user)) {
    onStep("making your wallet");
    await live.createWallet().catch(() => {}); // throws if Privy made one already (createOnLogin)
    if (!(await until(() => hasPrivyWallet(live.user)))) throw shown("your wallet isn't ready, try again");
  }
  onStep("joining");
  const token = await live.getAccessToken();
  if (!token) throw shown("sign in again");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ref: kept() }),
  });
  const data = await res.json().catch(() => ({}));
  // the server's own words, except a crash's "internal error"
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { shown: res.status !== 500 && data?.error, code: `http_${res.status}` });
  if (data?.ok !== true) throw Object.assign(new Error("bad answer"), { shown: false }); // the page's own line
  keep(null);
  return data;
}

/** Starts run(); join and resume hand back the running one instead of calling this twice. */
function fly(args) {
  flight = run(args)
    .catch(async (e) => {
      // a sign-in that can't go on: its email or X is on another Privy user, or the server refused
      // its token. Sign it out, so joining again starts clean rather than in the same dead end
      if (RESTART.has(e.code)) await live.logout?.().catch(() => {});
      throw e;
    })
    .finally(() => {
      flight = null;
    });
  return flight;
}

/** Signs `email` up: Privy's email code, X, a wallet, then /api/join. Resolves with the
 *  server's answer, { ok, nfts, early, already, email }; rejects with `.shown` for the page. */
export function join({ email, ref, endpoint, onStep = () => {} }) {
  if (flight) return flight;
  keep(ref);
  return fly({ email, endpoint, onStep, fromX: false });
}

/** Carries on after X sent the person back to the page. `ref` is the ?r= still in the URL,
 *  kept again in case sessionStorage lost it. */
export function resume({ ref, endpoint, onStep = () => {} }) {
  if (flight) return flight;
  if (ref) keep(ref);
  return fly({ endpoint, onStep, fromX: true });
}
