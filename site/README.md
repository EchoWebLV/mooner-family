# Mooner waitlist site

The landing page: static HTML, CSS and JS. `server.mjs` serves the page and keeps the signups
in SQLite. It has no dependencies; Node 22 or later.

## Run

```bash
node --disable-warning=ExperimentalWarning site/server.mjs
```

Joining needs the `PRIVY_*` keys and the welcome email needs `RESEND_API_KEY`. Locally, keep it in the vault and run
`vault run -- node --disable-warning=ExperimentalWarning site/server.mjs`.

It listens on `127.0.0.1:4410`. Signups go to `site/.data/waitlist.db`, created `0600` and
gitignored. The server never serves that folder.

| Env | Default | |
|---|---|---|
| `WAITLIST_PORT` (or `PORT`) | `4410` | |
| `WAITLIST_HOST` | `127.0.0.1` | `0.0.0.0` on a host that routes traffic in |
| `WAITLIST_DB` | `site/.data/waitlist.db` | put it on a persistent disk |
| `WAITLIST_TRUST_PROXY` | off | `1` behind a proxy that sets `X-Forwarded-For` |
| `RESEND_API_KEY` | none | sends the welcome email; without it signups are saved, no email goes out |
| `WAITLIST_FROM` | `Mooner <hello@mooner.family>` | the sender; its domain must be verified in Resend |
| `PRIVY_*` | none | joining, see below; without them it answers 503 |

## Joining

Joining needs a verified email and X account (since 2026-10-09). Privy proves the email (a code)
and X (X login) and makes a Solana wallet (`site/join/join.js`, built by
`node site/tools/build-join.mjs` into the gitignored `site/assets/join/`). The page then posts
`{ ref }` with the Privy token to `POST /api/join`, and `privy.mjs` checks it. One member per
email, per X account and per wallet.

- A new member gets 1 NFT, or 2 when their email or @handle is on the list from before the free
  NFT (`waitlist` rows with `nfts` empty). Resend sends the welcome email (`WELCOME` in
  `server.mjs`); a failed send is logged and the join stands.
- People already on the list don't join again: `--allowlist` lists them with their stored count
  and no wallet; they sign in with that email or X when they come back to mint. If one joins
  anyway, they claim their rows and the member row replaces them.
- The same Privy user again gets `already: true` and no second email.
- It answers `{ ok, nfts, early, already, email, emailed }`, or `{ error }` (400 missing email, X
  or wallet, or a throwaway domain; 401 sign in again; 409 email, X or wallet already joined;
  429 too many tries; 503 no Privy keys).
- It needs `PRIVY_APP_ID` (the "mooner" Privy app, the id in `join.js`), `PRIVY_APP_SECRET` and
  `PRIVY_VERIFICATION_KEY` (the PEMs from `auth.privy.io/api/v1/apps/<id>/jwks.json`), and X
  login turned on for that app in Privy's dashboard.

The email-only signup (`POST /api/waitlist`, 2026-10-08 to 10-09) is closed: it answers 410 so
an old page says to reload. Its rows stay in `waitlist` with `nfts` 1; a member who joins with
that email claims the row and gets 1.

When `server.mjs` serves the page, it sets the forms' `data-endpoint` to `/api/join`. On a
static host (no server) the forms stay in preview mode and say that nothing was saved.

## The lists

```bash
node --disable-warning=ExperimentalWarning site/server.mjs --allowlist > allowlist.csv
node --disable-warning=ExperimentalWarning site/server.mjs --members > members.csv
node --disable-warning=ExperimentalWarning site/server.mjs --export > waitlist.csv
```

There's no airdrop: everyone comes back to mint. `--allowlist` is who mints how many:
`wallet,nfts,email,x,ref,joined_at`, every member and then every
waitlist row no member claimed (wallet empty, 2 NFTs for a row from before the free NFT, else 1);
stderr says how many NFTs in all. `--members` is the members alone. `--export` is the old
waitlist: `contact,kind,ref,nfts,joined_at,claimed`. On Railway, run them with
`railway ssh --service web -- node --disable-warning=ExperimentalWarning /app/site/server.mjs --allowlist`.

## Moojis

`mooji.js` swaps standard emoji in the page's text for Mooner faces: 🙂 becomes
`assets/mooji/smile.svg`, 🚀 becomes `rocket.svg`, and so on. It covers 36 faces and 69
emoji. The emoji stays as the image's alt text, and the tooltip is a degen label ("wen
lambo", "rekt"). Text added later is converted too. Skipped: `code`, `pre`, form fields, and
anything under `data-no-mooji`. The map from emoji to file is at the top of `mooji.js`.

The SVGs are built from the logo's own paths in `assets/mooner.svg`, so the character is
never redrawn:

```bash
python3 site/tools/make-moojis.py
```

## Title badges

The badges on the titles and leaderboard cards (`assets/badges/`) are exported from the
app's own `Badge` component in `web/src/components/badges`, so they match the app exactly.
Each comes in full size and a small `-s` version. To change which ones are exported, edit
`WANT` in the script. It needs `web/node_modules`:

```bash
node site/tools/export-badges.mjs
```

## Test

```bash
node --disable-warning=ExperimentalWarning --test site/server.test.mjs site/privy.test.mjs
```
