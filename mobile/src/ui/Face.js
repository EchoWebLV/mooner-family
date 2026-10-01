import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { usePfp } from "../pfp/PfpRenderer";
import { shortWallet } from "./format";
import { C, F, R } from "./theme";

/** The smallest tap target a face gets when it can be tapped. */
const TAP = 36;

const hue = (wallet) => {
  let sum = 0;
  for (let i = 0; i < wallet.length; i++) sum += wallet.charCodeAt(i);
  return (sum * 37) % 360;
};

/** A wallet's face: its Mooner picture once the phone has it, until then (or if it won't
 *  load) the fallback, a colour from the wallet and its first two characters. `ring` (a
 *  colour) draws a 2px border. */
export function Face({ wallet, size = 32, ring }) {
  const w = wallet ?? "";
  const uri = usePfp(wallet, size);
  const [bad, setBad] = useState(null); // the uri that failed to load
  const picture = uri && bad !== uri;
  const inner = ring ? size - 4 : size;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue(w)}, 55%, 32%)`,
        alignItems: "center", justifyContent: "center",
        ...(ring ? { borderWidth: 2, borderColor: ring } : null),
        ...(picture ? { overflow: "hidden" } : null),
      }}
    >
      {picture ? (
        <Image source={{ uri }} onError={() => setBad(uri)} style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
      ) : (
        <Text style={{ fontFamily: F.mono, fontSize: size * 0.38, color: C.text0 }}>{w.slice(0, 2)}</Text>
      )}
    </View>
  );
}

/** Faces side by side, each overlapping the one before; "+N" when there are more than `max`.
 *  `ring` (a colour) rims each face. With `onPress(wallet)` each face is a button, its tap
 *  target at least TAP points. */
export function Faces({ wallets, size = 28, max = 6, ring, onPress }) {
  const list = wallets ?? [];
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  const shift = (i) => (i === 0 ? 0 : -size * 0.3);
  const slop = Math.max(0, (TAP - size) / 2);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((w, i) =>
        onPress ? (
          <Pressable
            key={`${w}:${i}`}
            accessibilityRole="button"
            accessibilityLabel={shortWallet(w)}
            hitSlop={slop}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onPress(w);
            }}
            style={({ pressed }) => [{ marginLeft: shift(i) }, pressed && { opacity: 0.7 }]}
          >
            <Face wallet={w} size={size} ring={ring} />
          </Pressable>
        ) : (
          <View key={`${w}:${i}`} style={{ marginLeft: shift(i) }}>
            <Face wallet={w} size={size} ring={ring} />
          </View>
        ),
      )}
      {more > 0 ? (
        <View
          style={{
            marginLeft: shift(shown.length), width: size, height: size, borderRadius: R.pill,
            backgroundColor: C.bg3, borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: size * 0.34, color: C.text1 }}>{`+${more}`}</Text>
        </View>
      ) : null}
    </View>
  );
}
