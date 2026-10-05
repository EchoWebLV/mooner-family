// Who's in, as a grid: each wallet's face and its SOL, biggest first. Past 10 wallets, the
// first 9 and "+N". A wallet that joins while the grid is on screen pops in.
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Face } from "../ui/Face";
import { shortWallet, solText } from "../ui/format";
import { CheckIcon } from "../ui/icons";
import { T } from "../ui/kit";
import { Move } from "../ui/motion";
import { C, F, R } from "../ui/theme";

const CELLS = 10;
const SIZE = 42;

/** `who`: whoIsIn(view) rows. `me`: the connected wallet, ringed in gold. `onFace(row)`: a tap
 *  on a face (not tappable without it). `ticks`: a tick on every face (the pool is full). */
export function Crowd({ who, me, onFace, ticks = false }) {
  const first = useRef(null);
  first.current ??= new Set(who.map((w) => w.user));
  if (!who.length) {
    return <T v="small" color={C.text2} style={{ textAlign: "center", paddingVertical: 8 }}>Nobody yet</T>;
  }
  const shown = who.length > CELLS ? who.slice(0, CELLS - 1) : who;
  const more = who.length - shown.length;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
      {shown.map((w) => {
        const cell = <Cell row={w} me={w.user === me} onFace={onFace} tick={ticks} />;
        return first.current.has(w.user) ? (
          <View key={w.user} style={{ width: "20%" }}>{cell}</View>
        ) : (
          <Move key={w.user} kind="pop" style={{ width: "20%" }}>{cell}</Move>
        );
      })}
      {more > 0 ? (
        <View style={{ width: "20%", alignItems: "center", gap: 4 }}>
          <View
            style={{
              width: SIZE, height: SIZE, borderRadius: R.pill, backgroundColor: C.bg3,
              borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.text1 }}>{`+${more}`}</Text>
          </View>
          <T v="small" color={C.text2} style={{ fontSize: 11 }}>more</T>
        </View>
      ) : null}
    </View>
  );
}

function Cell({ row, me, onFace, tick }) {
  const body = (
    <View style={{ alignItems: "center", gap: 4 }}>
      <View>
        <Face wallet={row.user} size={SIZE} ring={me ? C.gold : undefined} />
        {tick ? (
          <View
            style={{
              position: "absolute", right: -2, bottom: -2, width: 16, height: 16, borderRadius: 8,
              backgroundColor: C.up, borderWidth: 2, borderColor: C.bg1, alignItems: "center", justifyContent: "center",
            }}
          >
            <CheckIcon color={C.bg0} size={9} />
          </View>
        ) : null}
      </View>
      <T v="num" color={me ? C.gold : C.text1} style={{ fontSize: 11 }}>{solText(row.commit)}</T>
    </View>
  );
  if (!onFace) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${shortWallet(row.user)}, ${solText(row.commit)} SOL`}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onFace(row);
      }}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {body}
    </Pressable>
  );
}
