import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { C, F } from "./theme";

/** A coin's picture; its ticker's first letter when there is none or it won't load. */
export function CoinImage({ uri, size = 44, ticker }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.28, backgroundColor: C.bg3, overflow: "hidden",
        alignItems: "center", justifyContent: "center",
      }}
    >
      {uri && !failed ? (
        <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontFamily: F.semi, fontSize: size * 0.42, color: C.text1 }}>{Array.from(ticker ?? "")[0] ?? ""}</Text>
      )}
    </View>
  );
}
