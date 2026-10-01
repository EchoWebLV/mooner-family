import { useState } from "react";
import { Image, Text, View } from "react-native";
import { C, F } from "./theme";

/** A coin's picture; its ticker's first letter when there is none or it won't load. */
export function CoinImage({ uri, size = 44, ticker }) {
  const [bad, setBad] = useState(null); // the uri that failed to load
  const failed = bad === uri;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.28, backgroundColor: C.bg3, overflow: "hidden",
        alignItems: "center", justifyContent: "center",
      }}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          onError={() => setBad(uri)}
          style={{ width: size, height: size, borderRadius: size * 0.28 }}
        />
      ) : (
        <Text style={{ fontFamily: F.semi, fontSize: size * 0.42, color: C.text1 }}>{Array.from(ticker ?? "")[0] ?? ""}</Text>
      )}
    </View>
  );
}
