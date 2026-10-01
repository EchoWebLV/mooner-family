import { SvgXml } from "react-native-svg";
import svg from "./logo-svg";

/** The Mooner mark: assets/mooner.svg, as text (logo-svg.js is generated from the file). */
export function Logo({ size }) {
  return <SvgXml xml={svg} width={size} height={size} />;
}
