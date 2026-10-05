// One presale in Pulse's New Pairs: its coin, the time left (or Launching, Expired), the pool
// as 10 cells, the SOL in, the wallets in, and "You're in · X SOL" or Join.
import { useState } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { whoIsIn } from "../../../engine/src/views.js";
import { Cells } from "../ui/Cells";
import { CoinImage } from "../ui/CoinImage";
import { Faces } from "../ui/Face";
import { solText } from "../ui/format";
import { Card, Pill, T } from "../ui/kit";
import { C, F, R } from "../ui/theme";
import { Countdown, timeUp } from "./Countdown";

/** `view`: a `presales` list item; `info`: store.info (numbers in info.N); `wallet`: the
 *  connected wallet or null; `stage`: views.stageOf for it (presale, launching or expired).
 *  The list item names who's in only while it's OPEN, so a launching card shows no faces.
 *  Expired, or past its deadline, the card dims and stays tappable: the room says why it
 *  can't be joined. Join opens the room, like the rest of the card. A view with no coin
 *  draws nothing. */
export function PresaleCard({ view, info, wallet, stage, onPress }) {
  const [up, setUp] = useState(() => timeUp(view.deadlineTs, Date.now()));
  const token = view.token;
  if (!token) return null;
  const who = whoIsIn(view);
  const mine = wallet ? who.find((r) => r.user === wallet) : null;
  const open = stage === "presale";
  const dim = stage === "expired" || (open && up);
  const target = info.N.TARGET;
  const label =
    `$${token.symbol}, ${solText(view.raised)} of ${solText(target)} SOL` +
    (stage === "launching" ? ", launching" : stage === "expired" ? ", expired" : "") +
    (mine ? `, you're in with ${solText(mine.commit)} SOL` : "");
  return (
    <View style={dim ? { opacity: 0.5 } : null}>
      <Card
        accessibilityLabel={label}
        style={{ padding: 12 }}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress?.();
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <CoinImage uri={token.image} size={42} ticker={token.symbol} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <T v="body" numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.semi }}>{token.name}</T>
              {open ? (
                <Countdown deadlineTs={view.deadlineTs} onTimeUp={setUp} />
              ) : stage === "launching" ? (
                <Pill text="Launching" color={C.up} />
              ) : (
                <Pill text="Expired" color={C.text2} />
              )}
            </View>
            <T v="small" numberOfLines={1} style={{ fontFamily: F.mono }}>{`$${token.symbol}`}</T>
          </View>
        </View>
        <View style={{ marginTop: 10, marginBottom: 8 }}>
          <Cells raised={view.raised} target={target} height={6} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
            <T v="small" numberOfLines={1} style={{ fontFamily: F.mono, flexShrink: 1 }}>
              <T v="small" color={C.er} style={{ fontFamily: F.mono }}>{solText(view.raised)}</T>
              {` / ${solText(target)} SOL${who.length ? ` · ${who.length} in` : ""}`}
            </T>
            {who.length ? <Faces wallets={who.map((r) => r.user)} size={20} max={3} /> : null}
          </View>
          {mine ? <Pill text={`You're in · ${solText(mine.commit)} SOL`} color={C.gold} /> : open && !up ? <JoinTag /> : null}
        </View>
      </Card>
    </View>
  );
}

/** "Join", drawn as a small accent button: the whole card is the tap target. */
function JoinTag() {
  return (
    <View style={{ backgroundColor: C.accent, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 4 }}>
      <T v="small" color={C.accentInk} style={{ fontFamily: F.semi }}>Join</T>
    </View>
  );
}
