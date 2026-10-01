import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import svg from "./logo-svg";

/** The Mooner mark: assets/mooner.svg, as text (logo-svg.js is generated from the file). The
 *  moon is cut out of a black square, so white sits behind it, as on the web (Logo.module.css). */
export function Logo({ size }) {
  return (
    <View style={{ width: size, height: size, backgroundColor: "#fff", borderRadius: size * 0.24, overflow: "hidden" }}>
      <SvgXml xml={svg} width={size} height={size} />
    </View>
  );
}
