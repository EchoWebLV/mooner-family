# Mooner phone app: five screens (Pulse, Ranks, Create, Chat, Me)

Approved 2026-10-07 from the mockup `docs/superpowers/2026-10-07-mooner-five-screens.png` (layout A).

## Why

Pulse, Create and Me read as plain black screens. The lane names (New Pairs, Final Stretch, Migrated) are trading words, not Mooner words. Ranks and Chat exist on the web but not on the phone.

## Navigation (layout A)

- **Tabs stay three:** Pulse · Create · Me.
  - Me's tab shows your face (24 pt) and your SOL ("2.41 SOL", mono) once both are known. With no wallet, or before the balance arrives, it shows the Me icon and "Me".
- **Ranks and Chat are pushed screens**, opened from two round glass buttons on Pulse's scene: a trophy (Ranks) and a chat bubble (Chat). They have no tab bar and a glass back button.
- The chat button carries a green dot when a global chat line arrived live since Chat last showed the Everyone room (in memory only, per app run).

## Shared pieces

- **Scene header:** the existing `Scene` (picture, veil, slow move) at a fixed height. The title (28, semibold) sits top-left. Glass buttons sit top-right: 38 pt circles, `#07080b8c` fill, a `#ffffff24` rim, and a 20 pt icon. The status bar stays light over it.
- **New icons** (same SVG style as `ui/icons.js`): trophy, settings (gear), info, copy, crown. The back icon already exists.
- **Title tag:** a small pill showing the title and its level in Roman numerals ("KOL II"), coloured by title: Dev `up`, KOL `accent`, Raider `down`, Diamond Hands `migrated`. A soft fill of the same colour at 0.12. Levels come from `levelOf` in `engine/src/xp.js` (I–V on `LEVEL_XP` = 0, 100, 300, 800, 2000).
- **Names:** Mooner has no handles. Every person shows as their short wallet (`shortWallet`), the way the room and chat already do. Your own row reads "you".
- **Motion and sound** keep the 2026-10-05 rules:
  - Pulse only fades and taps.
  - Elsewhere, things rise or pop in once and the host types.
  - No count-ups, bursts or bumps.

## Pulse (tab)

- **Scene:** `room`, 236 pt tall. "Pulse" top-left; trophy and chat glass buttons top-right.
- **Stat** over the scene's bottom-left: the SOL filling the pools, large in mono green ("4.2 SOL"), and under it "filling N pools right now". It stays blank, keeping its height, until both feeds are in (today's rule).
- **Lanes renamed:** Filling · Live · Mooned. The ids and the logic in `live/lanes.js` don't change; only the copy does.
  - Empty states:
    - Filling: "No pools filling right now" / "New ones show up here the moment they open."
    - Live: "Nothing live yet" / "Coins land here the moment their pool fills."
    - Mooned: "Nothing mooned yet" / "Coins move here when their curve reaches {GRAD_SOL} SOL."
- **Segmented control** replaces the underlined tabs:
  - A `bg1` track with a `line` rim, radius 12, 3 pt inset.
  - The active lane gets a `bg3` pill, `text0` label and its count in `up`. Inactive lanes show the label in `text2`-ish and the count dimmer.
  - Counts still fade in once and stay hidden until known.
- **Cards and the swipe pager** stay as they are. The wallet SOL and Connect leave Pulse's header: SOL moves to the Me tab.
  - With no wallet, Pulse shows no Connect. Join and Me already lead to Connect.

## Ranks (pushed, `app/ranks.js`)

- **Data:** the server's XP rows (piece 6's `xp` messages on the `profiles` topic: the top 500, then changed rows), kept by the store.
  - Until the `profiles` topic's first snapshot there's a spinner.
  - After it, with no `xp` message yet or no rows, it shows "No ranks yet" / "XP comes from launches: open one, chip in, bring friends, hold." (A server without XP never sends one.)
- **Scene:** `live`, 300 pt, with back, "Ranks", and an info glass button. Info opens a sheet listing the four titles and what earns each, read from `POINTS`.
- **Podium** over the scene's bottom, for the top 3 of the board:
  - #1 in the middle: a 76 pt face, gold ring and glow, a crown icon above.
  - #2 on the left (silver ring) and #3 on the right (bronze), both 58 pt.
  - Each shows its place badge, short wallet and XP (mono, `up`).
- **Board chips:** Overall · Dev · KOL · Raider · Diamond Hands. Overall sorts by `total` and each title by its own XP. Ties break by wallet. Rows with 0 on that board are left out.
- **Rows #4 and down:** rank (mono, `text2`), a 34 pt face, short wallet, a title tag, XP (mono). On Overall the tag is the wallet's top title and its level; on a title's board, that title and its level there. A tap does nothing for now: there's no phone profile page.
- **Your row** is pinned at the bottom with an accent rim: "#14", your face, "you", your top title tag, your XP on this board.
  - If you aren't on this board, it shows "Not ranked yet: chip in to a launch".
  - With no wallet, there is no pinned row.

## Create (tab)

- **Scene:** `launching`, 210 pt. "Create" top-left; a "1 / 4" pill top-right; Back stays where it is today, left of the title on steps 2 to 4.
- **The host** stands at the scene's bottom-left with its bubble (the `Host` component). Its line follows the step:
  - Picture: "Start with a picture. Square works best."
  - Details: "Name it, and give it a ticker."
  - Seat: "Pick your seat. You're the first one in."
  - Launch: "Last look. Then open the pool."
- **Step bar** under the scene: four 4 pt segments labelled Picture · Details · Your seat · Launch. Done and current segments are `up`; the current label is `text0`.
- **Step contents** (PictureStep, DetailsStep, CommitStep, ReviewStep), the signed-out screen, the unopened-coin card and every flow rule stay as they are.

## Chat (pushed, `app/chat.js`)

- **Scene:** `room`, 150 pt, with back and "Chat".
- **Room chips:** Everyone (the server's `global` channel), then one chip per presale you're in whose coin is known (coin image and $TICKER, in the order Me lists your launches). The shown room is a white pill.
- **Messages,** newest at the bottom:
  - A 32 pt face, short wallet (yours in gold), the sender's top title tag once XP rows know them, and the time (`hhmm`).
  - The text goes through `ChatText`, so emojis and $TICKER links work as today.
- **Composer:** the existing emoji row, input, send button, sign-in and errors, taken out of `ChatSheet` into a shared `ChatPane`. The room's `ChatSheet` uses the same pane, so nothing changes in the room.
- **Store:**
  - `watchChat(channel)` subscribes `chat:<channel>` (`global` or a presale key).
  - `sendChat` takes `global` as is; the server accepts it today.
  - The app subscribes `chat:global` for its whole run, for the unread dot. A line seen while Chat shows Everyone clears the dot.

## Me (tab)

- **Scene:** `live`, 150 pt. "Me" top-left; a gear glass button top-right opens a settings sheet with the Sounds switch and Disconnect (both moved out of the page).
- **You:**
  - Your face at 92 pt, overlapping the scene's bottom edge, with a gold ring.
  - Beside it, your short wallet with the copy icon (the existing Copy behaviour).
- **Two boxes:** Balance ("2.41 SOL", with "≈ $x" under it when the price is known) and Rank ("#14 of N" from the Overall board; "–" until XP rows arrive; "Not ranked" if you have no row).
- **XP card:**
  - Your top title and level ("KOL II") on the left. Your streak on the right when `streak.days > 0`: the fire emoji and "N days".
  - A bar to your top title's next level, with "1,240 / 2,000 XP" and "760 to KOL III". At level V it reads "Max level".
  - The four title tags.
  - The Seeker Genesis check (piece 6 Task 16's flow) as a row in the card: "Seeker Genesis" with Check, or the Genesis mark once claimed.
  - No row yet: "No XP yet. Chip in to a launch to start."
- **Your launches:** today's presale rows (`rowsOf`), as list rows with coin, $TICKER and the status pill.
- **Signed out:** the scene without the gear, then as today (logo, Connect Seed Vault, Sounds).

## Out of this build

- **Change Mooner on the phone.** The trait list lives in the web's TypeScript and the phone has no editor. It's left out until the traits are shared.
- **Pool link cards in chat,** follow buttons on Ranks rows, and a phone profile page.
- **The web's leaderboard and profile on real XP** (piece 6 Tasks 9, 10 and 17). The web keeps its demo data for now.

## Real XP (piece 6)

The plan `docs/superpowers/plans/2026-10-01-mooner-seeker-xp-genesis.md` builds the ledger, rules, routes and the `xp` rows on `profiles`. This build uses:
- **Tasks 1–6** as written.
- **Tasks 7 and 8 without push piece 5's Tasks 5 and 7.** Those aren't in, so each change anchors on today's `feed.js` and `main.js`.
- **Phone Tasks 12–14:** the shared streak, rows as the phone shows them, and the store keeping XP rows plus the Genesis check.
- Its Tasks 15 and 16 are replaced by Ranks and Me above, with no FollowButton.
- **Deploy** is the user's step (its Task 11). Until then, Ranks shows its empty state on the live server.

## Testing

- **Pure logic gets Node tests in `mobile/test`:** boards and sorting, the top title, rank, the next-level bar, room chips, the unread dot, and the Me tab label.
- **Screens** get the bundle parse check (`npm run bundle:check`).
- **On the phone:** a release build, then each screen checked against the mockup.
