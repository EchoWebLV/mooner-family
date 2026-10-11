# Mooner waitlist: verified signups and a free NFT

Approved 2026-10-08 in chat. Covers mooner.family (`site/`) only.

## What changes

- Joining the waitlist now gets you a free Mooner NFT.
- People already on the list (97 rows on 2026-10-08) get 2. Changed 2026-10-09: they don't sign
  up again. `--allowlist` lists them with their email or handle and no wallet, and the line
  under each form says "already on the list? you're in, come back at mint for 2".
- Every new signup must verify a real email and log in with X. The old "email or @handle" signup ends.
- The NFTs are not minted at signup. Each signup records a wallet and a count (1 or 2). Changed 2026-10-09: no airdrop; everyone comes back to mint (`--allowlist`).

## Out of scope

- The NFT art, the collection and the mint.
- Showing the NFT in the app.

## The page

- Both forms keep the email field and the "join waitlist" button. The placeholder becomes "your email".
- A line under each form: "free Mooner NFT for joining. already on the list? you get 2."
- **Join:**
  1. The page checks the email's shape, as now.
  2. It loads the join bundle (see "The join bundle"), only on that first click.
  3. Privy opens with the email filled in (`login({ prefill: { type: 'email', value } })`). Privy mails a code, and the person types it.
  4. With no X linked, the page calls `linkTwitter()`. That redirects to X and back to mooner.family.
  5. With no email linked (someone who chose X in the modal), the page calls `linkEmail()`.
  6. With no Privy Solana wallet, the page creates one.
  7. The page posts to `/api/join` and shows the answer in the form's message line.
- **Back from X:** the URL carries `privy_oauth_code`, `privy_oauth_state` and `privy_oauth_provider`. On load, `main.js` sees them, loads the bundle, and finishes from step 5.
- **Messages:**
  - "you're in. 1 NFT reserved"
  - "you're in. 2 NFTs reserved, thanks for being early"
  - "you're already in. N NFTs reserved"
  - Otherwise, the server's error text.
- **The wallet:** the NFT goes to the Privy wallet. Changed 2026-10-08: signups use the "mooner" Privy app, not the web app's (MagicPd), so app.mooner.family does not show this wallet.

## The join bundle

- Source: `site/join/join.js` (plain JS, `createElement`, no JSX), a small React root around `PrivyProvider`. It exports `join({ email, ref, endpoint, onStep })` and `resume({ endpoint, onStep })` for the X return.
- **Privy config:**
  - `loginMethods: ['email', 'twitter']`, dark theme, Solana only.
  - `embeddedWallets.solana.createOnLogin: 'users-without-wallets'`, as in `web/src/main.tsx`.
- **Build:**
  - Uses web's Vite (8.3.1) and `web/node_modules` (React 19.3, `@privy-io/react-auth` 3.45.0), borrowed the way `site/tools/export-badges.mjs` borrows web's rolldown.
  - Build script `site/tools/build-join.mjs`, output in `site/assets/join/`.
  - The app id ("mooner" Privy app, public) is a constant in `join.js`.
  - `deploy/railway.sh site` builds the bundle first, then ships it with `site/assets`. `site/assets/join/` is gitignored as build output.
  - `join.js` keeps its name across builds (`main.js` imports it by name), so it's served `no-cache`. Its chunks are hashed and keep the day-long cache of `assets/`.
- **Size:** it is large because of Privy. The page never loads it until someone clicks join or comes back from X.

## The server (`site/server.mjs`)

**`POST /api/join`**
- Takes `Authorization: Bearer <Privy access token>` and the JSON body `{ ref }`.
- **Checks the token with `node:crypto`, no new dependency:**
  - ES256.
  - `iss` = `privy.io`.
  - `aud` = `PRIVY_APP_ID`.
  - `exp` in the future, with 30 s of skew allowed.
  - Signed by `PRIVY_VERIFICATION_KEY`: the PEM from Privy's dashboard, Configuration > App settings.
- **Reads the user from Privy**, never from the browser: `GET https://api.privy.io/v1/users/{sub}` with the `privy-app-id` header and Basic auth (`PRIVY_APP_ID:PRIVY_APP_SECRET`). From `linked_accounts` it takes:
  - **Email:** `type: 'email'` → `address`.
  - **X:** `type: 'twitter_oauth'` → `subject` (stable id) and `username`.
  - **Wallet:** `type: 'wallet'`, `chain_type: 'solana'`, `wallet_client_type: 'privy'` → `address`.
- **Refuses:**

  | Status | When | Error text |
  |---|---|---|
  | 401 | bad or expired token | "sign in again" |
  | 400 | no email linked | "verify your email" |
  | 400 | no X linked | "log in with X" |
  | 400 | no wallet yet | "your wallet isn't ready, try again" |
  | 400 | throwaway email domain | "use a real email, not a throwaway one" |
  | 409 | this email, X account or wallet is already on another member | — |
  | 502 | Privy didn't answer | "couldn't reach sign-in, try again" |
  | 429 | rate limit (stays: 20 tries per address per 10 min) | — |

- **Joins, in one transaction:**
  - The same Privy user again gets their row back with `already: true`.
  - Otherwise it looks for early rows: `waitlist` rows whose `contact` is the email, or `@` + the lowercased X `username`, and whose `claimed_by` is empty.
  - If any match, `nfts` = 2, and every matched row gets `claimed_by` = the Privy id. Otherwise `nfts` = 1.
  - One person gets 2 once, even when both their email and their handle were on the old list.
- **Answers** `{ ok: true, nfts, early, already, email }`. `email` is the verified one from Privy, so the page can show it after the trip to X.

**`POST /api/waitlist`** (the old endpoint) answers 410 "refresh the page". A page cached before the switch can't add unverified rows.

**Throwaway domains**
- `site/disposable-domains.txt`: a copy of the CC0 list from github.com/disposable-email-domains/disposable-email-domains.
- Loaded at start.
- An email is refused when its domain, or any parent domain, is on the list.
- The list is public, so serving it does no harm.

**Env** (Railway service "web", and `vault` locally):
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `PRIVY_VERIFICATION_KEY`

Without them, `/api/join` answers 503 "signups are paused".

## Data (`/data/waitlist.db`)

- **`waitlist`:** the early list, frozen. It gains one column, `claimed_by TEXT`, added at start when it's missing. No rows are deleted or changed apart from `claimed_by`.
- **`members`:**

  | Column | Type | Constraint |
  |---|---|---|
  | `privy_id` | TEXT | PRIMARY KEY |
  | `email` | TEXT | UNIQUE NOT NULL |
  | `x_id` | TEXT | UNIQUE NOT NULL |
  | `x_handle` | TEXT | |
  | `wallet` | TEXT | UNIQUE NOT NULL |
  | `nfts` | INTEGER | NOT NULL |
  | `ref` | TEXT | |
  | `created_at` | INTEGER | NOT NULL |

- **Exports:**
  - `--export` stays: the early list, plus a `claimed` column.
  - `--members` prints the members as CSV: `wallet,nfts,email,x,ref,joined_at`.

## Known limits

- Someone who renamed their X account since joining the old list won't match by handle. They get 1 unless their email matches.
- An old X row typed by someone who didn't own the handle now goes to whoever owns it, because X login proves the handle.

## Setup outside the code (the user)

- **Privy dashboard:**
  - Allowed origins: add `https://mooner.family` and `https://www.mooner.family`.
  - For the local test, add `http://localhost:4410` and remove it after.
  - Confirm email and X login are on.
  - Copy the verification key and the app secret.
- `vault set PRIVY_APP_SECRET` and `vault set PRIVY_VERIFICATION_KEY`. The Railway variables are then set from the vault.

## Testing

**`site/server.test.mjs`, with a Privy stub injected into `createApp`:**
- **Token:** good, expired, wrong `aud`, wrong `iss`, bad signature. Uses an ES256 key made in the test.
- **Missing links:** no email, no X, no wallet.
- **Throwaway domains:** the domain itself and a subdomain.
- **Early matches:** by email, by handle, by both (2 once, both rows claimed), and a row already claimed (1).
- **Joins:** a repeat join returns the same row; a conflict answers 409.
- **Old endpoint and config:** `/api/waitlist` answers 410; missing env answers 503; `--members` CSV.

**Browser:** on localhost:4410, the bundle loads only on click, and Privy opens with the email filled in. The full email + X run is done by the user with their own accounts.
