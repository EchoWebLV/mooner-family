import { Text, View } from "react-native";
import { C, F, R } from "./theme";

const hue = (wallet) => {
  let sum = 0;
  for (let i = 0; i < wallet.length; i++) sum += wallet.charCodeAt(i);
  return (sum * 37) % 360;
};

/** A wallet's face. For now the fallback only: a colour from the wallet and its first two
 *  characters. `ring` (a colour) draws a 2px border. */
export function Face({ wallet, size = 32, ring }) {
  const w = wallet ?? "";
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue(w)}, 55%, 32%)`,
        alignItems: "center", justifyContent: "center",
        ...(ring ? { borderWidth: 2, borderColor: ring } : null),
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: size * 0.38, color: C.text0 }}>{w.slice(0, 2)}</Text>
    </View>
  );
}

/** Faces side by side, each overlapping the one before; "+N" when there are more than `max`. */
export function Faces({ wallets, size = 28, max = 6 }) {
  const list = wallets ?? [];
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  const shift = (i) => (i === 0 ? 0 : -size * 0.3);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((w, i) => (
        <View key={`${w}:${i}`} style={{ marginLeft: shift(i) }}>
          <Face wallet={w} size={size} />
        </View>
      ))}
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
