// Me's XP card from your row (the store's `xp`): your top title and level, the streak, the bar
// to the next level, the four title tags, the Seeker Genesis row (Check, or the mark) and the
// X row (Link X, or your handle).
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useStore } from "zustand";
import { RAIDER_FLOOR, streakDays } from "../../../engine/src/xp.js";
import { store } from "../app";
import { CheckIcon } from "../ui/icons";
import { Button, Card, PillButton, Sheet, T } from "../ui/kit";
import { TitleTag } from "../ui/TitleTag";
import { C, F } from "../ui/theme";
import { useSigner } from "../wallet";
import { TITLE_COLORS, nextLevelOf, tagText } from "./look";
import { GENESIS_XP, mainTitleOf, tagWords, titlesOf, xpNum, xpText } from "./rows";
import { X_BACK, isXBack } from "./xlink";

/** `wallet`: the connected one. A spinner until its row is here (the read on connect, or a
 *  push); a failed read says so with Try again. The server's rows are the only numbers shown. */
export function XpCard({ wallet }) {
  const row = useStore(store, (s) => s.xp[wallet]);
  const failed = useStore(store, (s) => s.xpFailed);
  const x = useStore(store, (s) => s.xLinks[wallet]); // undefined: not read yet
  const signer = useSigner();
  const signedIn = useStore(store, (s) => s.session != null && s.session.exp > Date.now() && s.wallet === signer?.publicKey.toBase58());
  const genesisShown = !!(row || failed);
  const [passed, setPassed] = useState(false);
  let body;
  if (row) body = <Progress row={row} />;
  else if (failed) body = <ReadFailed />;
  else body = <ActivityIndicator color={C.text1} style={{ alignSelf: "flex-start" }} />;
  return (
    <>
      <Card style={{ gap: 12 }}>
        {body}
        {genesisShown ? <GenesisRow has={!!row?.genesis} onPassed={() => setPassed(true)} /> : null}
        {x !== undefined ? <XRow x={x} /> : null}
        {/* once for both rows: either button signs in first */}
        {!signedIn && ((genesisShown && !row?.genesis) || x === null) ? (
          <T v="small" color={C.text2}>Your wallet signs you in to Mooner first. No SOL moves.</T>
        ) : null}
      </Card>
      {/* outside the card, so it stays up when the new row redraws the card */}
      <Sheet open={passed} onClose={() => setPassed(false)} title="Seeker Genesis">
        <View style={{ gap: 16 }}>
          <T v="bigNum" color={C.gold}>{`+${xpText(GENESIS_XP)}`}</T>
          <T v="body" color={C.text1}>Your Mooner has the Seeker Genesis mark.</T>
          <Button title="Done" kind="gold" onPress={() => setPassed(false)} />
        </View>
      </Sheet>
    </>
  );
}

/** Your row's read failed (and no push brought it): say so, and Try again (the store reads
 *  it again, with the spinner meanwhile). */
function ReadFailed() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <T v="small" color={C.text2} style={{ flex: 1 }}>Couldn't read your XP right now.</T>
      <PillButton title="Try again" onPress={() => store.getState().retryXp()} accessibilityLabel="Try reading your XP again" />
    </View>
  );
}

/** Your top title and level, the streak, the bar to the next level, the four tags. */
function Progress({ row }) {
  const main = mainTitleOf(row);
  if (!main) {
    if (!row.total) return <T v="small" color={C.text1}>No XP yet. Chip in to a launch to start.</T>;
    return (
      <>
        <T style={{ fontFamily: F.semi, fontSize: 22 }}>{xpText(row.total)}</T>
        <T v="small">Chip in to a launch to earn a title.</T>
        <Tags row={row} />
      </>
    );
  }
  const next = nextLevelOf(main.xp);
  const streak = streakDays(row.streak, Date.now());
  const color = TITLE_COLORS[main.title];
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T accessibilityLabel={tagWords(main.title, main.level)} style={{ fontFamily: F.semi, fontSize: 22, color }}>{tagText(main.title, main.level)}</T>
        {streak > 0 ? <T v="small" color={C.text0}>{`🔥 ${streak} ${streak === 1 ? "day" : "days"}`}</T> : null}
      </View>
      {/* the fill and the rest share the row by `fill` (0..1); hidden from a screen reader,
          the line under it says the same */}
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ height: 8, borderRadius: 4, backgroundColor: C.bg3, overflow: "hidden", flexDirection: "row" }}
      >
        <View style={{ flex: next.fill, borderRadius: 4, backgroundColor: color }} />
        <View style={{ flex: 1 - next.fill }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <T v="small" style={{ fontFamily: F.mono, flexShrink: 1 }}>{next.max ? xpText(main.xp) : `${xpNum(main.xp)} / ${xpText(next.to)}`}</T>
        <T
          v="small"
          accessibilityLabel={next.max ? undefined : `${xpText(next.left)} to ${tagWords(main.title, next.level + 1)}`}
          style={{ flexShrink: 1, textAlign: "right" }}
        >
          {next.max ? "Max level" : `${xpNum(next.left)} to ${tagText(main.title, next.level + 1)}`}
        </T>
      </View>
      <Tags row={row} />
    </>
  );
}

/** The four title tags; a title with no XP is dimmed (and says so to a screen reader). */
function Tags({ row }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {titlesOf(row).map((t) => {
        const none = t.xp <= 0;
        return (
          <View key={t.title} accessible={none} accessibilityLabel={none ? `${t.name}, no XP yet` : undefined} style={{ opacity: none ? 0.35 : 1 }}>
            <TitleTag title={t.title} level={t.level} />
          </View>
        );
      })}
    </View>
  );
}

/** "Seeker Genesis": Check (the server reads the wallet's tokens and decides), or the mark
 *  once your row has it. The first pass calls `onPassed` (the sheet). Check stays in place
 *  while it works, so a screen reader's focus stays on it. */
function GenesisRow({ has, onPassed }) {
  const signer = useSigner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pressing = useRef(false); // set at once, so a second tap before the re-render does nothing

  async function check() {
    if (pressing.current || !signer) return;
    pressing.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await store.getState().checkGenesis(signer);
      if (r.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (r.fresh) onPassed();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(r.error);
      }
    } finally {
      pressing.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.semi, fontSize: 15 }}>Seeker Genesis</T>
          <T v="small">
            {has
              ? "Your Mooner has the Seeker Genesis mark."
              : `Got a Seeker Genesis Token in this wallet? Check it once for the mark and +${xpText(GENESIS_XP)}.`}
          </T>
        </View>
        {has ? (
          <View
            accessible
            accessibilityLabel="Seeker Genesis mark"
            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.goldSoft, alignItems: "center", justifyContent: "center" }}
          >
            <CheckIcon color={C.gold} size={16} />
          </View>
        ) : (
          <PillButton title="Check" busy={busy} onPress={check} accessibilityLabel="Check this wallet for a Seeker Genesis Token" />
        )}
      </View>
      {error && !has ? <T v="small" color={C.down} accessibilityLiveRegion="polite">{error}</T> : null}
    </View>
  );
}

/** X's sign-in page in the browser (a Custom Tab on Android), closed by itself on the way back:
 *  the link X sent back, or null when it was closed first. */
async function openAuth(url) {
  if (isXBack(url)) return url; // linked already (the demo server): no page to show
  const r = await WebBrowser.openAuthSessionAsync(url, X_BACK);
  return r.type === "success" ? r.url : null;
}

const FLOOR_TEXT = `Raider XP counts X accounts with ${RAIDER_FLOOR.followers}+ followers, made ${RAIDER_FLOOR.days}+ days ago.`;

/** "X": Link X (signs in first if needed, then X's own page asks you to allow it), or your
 *  handle once linked: posts and reposts about a coin earn Raider XP (engine/server/raiders.js).
 *  An account under RAIDER_FLOOR says so, and can be swapped for another. Unlink is in
 *  Settings. `x`: the store's xLinks row, null for none. */
function XRow({ x }) {
  const signer = useSigner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pressing = useRef(false); // set at once, so a second tap before the re-render does nothing
  const low = x?.ok === false;

  async function link() {
    if (pressing.current || !signer) return;
    pressing.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await store.getState().linkX(signer, openAuth);
      if (r.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else if (r.error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(r.error);
      }
    } finally {
      pressing.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.semi, fontSize: 15 }} numberOfLines={1}>{x ? `@${x.handle}` : "X"}</T>
          <T v="small" color={low ? C.text2 : undefined}>
            {!x ? "Link your X. Posts and reposts about a coin earn Raider XP." : low ? FLOOR_TEXT : "Your posts and reposts about a coin earn Raider XP."}
          </T>
        </View>
        {x && !low ? (
          <View
            accessible
            accessibilityLabel={`X linked as ${x.handle}`}
            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: `${C.up}21`, alignItems: "center", justifyContent: "center" }}
          >
            <CheckIcon color={C.up} size={16} />
          </View>
        ) : (
          <PillButton
            title={low ? "Change" : "Link X"}
            busy={busy}
            onPress={link}
            accessibilityLabel={low ? "Link another X account" : "Link your X account"}
          />
        )}
      </View>
      {error ? <T v="small" color={C.down} accessibilityLiveRegion="polite">{error}</T> : null}
    </View>
  );
}
