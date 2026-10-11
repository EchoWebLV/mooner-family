# Mooner alerts + Activity — design (2026-10-11)

Builds the push part of `plans/2026-10-01-mooner-seeker-push.md` (Tasks 1–3 already built), with the look of the
notification mockups (`.superpowers/mockups/notif.html`, renders in `docs/superpowers/2026-10-11-mooner-notif-mockups/`).

## In

- **Real pushes** through Expo's push service → Firebase (FCM), as the Oct 1 plan has it (Tasks 4–9, 15, 16).
- **Kinds:** your pool filled, it launched, your tokens arrived, someone joined the pool you opened, a coin passed a
  market-cap line (the Oct 1 kinds), plus a new **`xp`** kind: one of your titles went up a level
  (e.g. "Raider level 2").
- **Activity screen** instead of the plan's Alerts tab:
  - a bell round button on Pulse's header, next to the trophy and chat, with an unread dot like chat's;
  - a pushed screen "Activity": back chevron, big title, "Mark all read", segmented **All / Launches / XP / Coins**,
    sections **Today / Earlier**, rows in one rounded card: coin picture (or a colored glyph for XP), title, body,
    time in mono, unread dot. Looks like the mockup's `#inbox`;
  - a tap opens the presale or the coin (XP opens Ranks).
- **Switches** (one per kind, all on for a new phone) move from the Alerts tab to **Me → Settings → Notifications**.
- **Sign-out stops this phone's alerts** (from Oct 1 Task 13; the follow lists stay out).
- **Push look on Android:** title + body as the mockup's lock screen, the coin's picture on the push where Expo's push
  API supports it, a high-importance channel so pushes show as a banner.

## Out (later)

- Follow buttons, following lists, Auto-join (phone and web). The server keeps follow alerts (the `follows` table is
  built) so they work once a Follow button exists; Auto-join's `room` kind and routes are not built.
- Rewards alerts ("0.84 SOL to claim"): the rewards split isn't built.
- The lock-screen countdown card: a push can't draw it on Android.
- The small status-bar icon: Android needs a white one-shape silhouette; the user supplies it (Oct 1 USER STEP G).

## What Android draws, not us

The Seeker's lock screen, clock, wallpaper and the notification card style are Android's. We control each push's
words, picture, accent color and channel. The Activity screen is ours and matches the mockup exactly.

## User steps (from the Oct 1 plan, Task 15)

A. Expo project `mooner` → tell the agent its project ID and owner. B. Firebase Android app `family.mooner.app` →
`mobile/google-services.json` (gitignored). C. Firebase service-account key → uploaded to Expo only. D. (optional)
Expo enhanced security + `MOONER_EXPO_TOKEN` on Railway. E. Deploy the server. G. (optional) the white status icon.

## Testing

Engine and phone tests as the Oct 1 plan, plus: the `xp` kind fires once per title level, never for a level the
wallet already had at server start; Activity rows group Today/Earlier and filter by tab. On the emulator: the bell,
Activity, Settings switches. On the Seeker after the user steps: a real push shows as a banner and on the lock screen,
and a tap opens the right screen.
