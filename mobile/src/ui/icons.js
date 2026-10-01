// Tab icons, drawn in the tab's tint: 22 px on a 24-unit grid.
import Svg, { Circle, Path } from "react-native-svg";

const STROKE = { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };

/** A live dot: a filled circle in a ring. */
export function LiveIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} {...STROKE} />
      <Circle cx={12} cy={12} r={4} fill={color} />
    </Svg>
  );
}

/** An arrow up and to the right. */
export function LaunchedIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 18 L18 6 M8 6 H18 V16" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A person, outlined: a head over shoulders. */
export function MeIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8} r={4} stroke={color} {...STROKE} />
      <Path d="M4 21 C4 16.6 7.6 13 12 13 C16.4 13 20 16.6 20 21" stroke={color} {...STROKE} />
    </Svg>
  );
}
