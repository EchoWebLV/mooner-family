// Me's XP card from your row (the store's `xp`): your top title and level, the streak, the bar
// to the next level, the four title tags, and the Seeker Genesis row (Check, or the mark).
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { streakDays } from "../../../engine/src/xp.js";
import { store } from "../app";
import { CheckIcon } from "../ui/icons";
import { Button, Card, PillButton, Sheet, T } from "../ui/kit";
import { TitleTag } from "../ui/TitleTag";
import { C, F } from "../ui/theme";
import { useSigner } from "../wallet";
import { TITLE_COLORS, nextLevelOf, tagText } from "./look";
import { GENESIS_XP, mainTitleOf, titlesOf, xpNum, xpText } from "./rows";

/** `wallet`: the connected one. A spinner until its row is here (the read on connect, or a
 *  push); the server's rows are the only numbers shown. */
export function XpCard({ wallet }) {
  const row = useStore(store, (s) => s.xp[wallet]);
  const failed = useStore(store, (s) => s.xpFailed);
  const [passed, setPassed] = useState(false);
  let body;
  if (row) body = <Progress row={row} />;
  else if (failed) body = <T v="small" color={C.text2}>Couldn't read your XP right now.</T>;
  else body = <ActivityIndicator color={C.text1} style={{ alignSelf: "flex-start" }} />;
  return (
    <>
      <Card style={{ gap: 12 }}>
        {body}
        {row || failed ? <GenesisRow has={!!row?.genesis} onPassed={() => setPassed(true)} /> : null}
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
        <T style={{ fontFamily: F.semi, fontSize: 22, color }}>{tagText(main.title, main.level)}</T>
        {streak > 0 ? <T v="small" color={C.text0}>{`🔥 ${streak} ${streak === 1 ? "day" : "days"}`}</T> : null}
      </View>
      {/* the fill and the rest share the row by `fill` (0..1) */}
      <View style={{ height: 8, borderRadius: 4, backgroundColor: C.bg3, overflow: "hidden", flexDirection: "row" }}>
        <View style={{ flex: next.fill, borderRadius: 4, backgroundColor: color }} />
        <View style={{ flex: 1 - next.fill }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <T v="small" style={{ fontFamily: F.mono }}>{next.max ? xpText(main.xp) : `${xpNum(main.xp)} / ${xpText(next.to)}`}</T>
        <T v="small">{next.max ? "Max level" : `${xpNum(next.left)} to ${tagText(main.title, next.level + 1)}`}</T>
      </View>
      <Tags row={row} />
    </>
  );
}

/** The four title tags; a title with no XP is dimmed. */
function Tags({ row }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {titlesOf(row).map((t) => (
        <View key={t.title} style={{ opacity: t.xp > 0 ? 1 : 0.35 }}>
          <TitleTag title={t.title} level={t.level} />
        </View>
      ))}
    </View>
  );
}

/** "Seeker Genesis": Check (the server reads the wallet's tokens and decides), or the mark
 *  once your row has it. The first pass calls `onPassed` (the sheet). */
function GenesisRow({ has, onPassed }) {
  const signer = useSigner();
  const signedIn = useStore(store, (s) => s.session != null);
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
        ) : busy ? (
          <ActivityIndicator color={C.text1} />
        ) : (
          <PillButton title="Check" onPress={check} accessibilityLabel="Check this wallet for a Seeker Genesis Token" />
        )}
      </View>
      {!has && !signedIn ? <T v="small" color={C.text2}>Your wallet signs you in to Mooner first. No SOL moves.</T> : null}
      {error ? <T v="small" color={C.down}>{error}</T> : null}
    </View>
  );
}
