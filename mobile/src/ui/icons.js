// The app's icons, on a 24-unit grid with one stroke: the tabs (22 px, in the tab's tint), and
// the small ones the screens use (back, chat, tick, padlock, send).
import Svg, { Circle, Path, Rect } from "react-native-svg";

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

/** A chevron pointing left: back. */
export function BackIcon({ color, size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 5 L8 12 L15 19" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A speech bubble: the chat. */
export function ChatIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 6.5 C4 5.1 5.1 4 6.5 4 H17.5 C18.9 4 20 5.1 20 6.5 V14 C20 15.4 18.9 16.5 17.5 16.5 H10 L6 20 V16.5 C4.9 16.5 4 15.6 4 14.5 Z" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A tick. */
export function CheckIcon({ color, size = 14 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12.5 L10 17.5 L19 7" stroke={color} {...STROKE} strokeWidth={3} />
    </Svg>
  );
}

/** A padlock. */
export function LockIcon({ color, size = 14 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={5} y={11} width={14} height={10} rx={2} stroke={color} {...STROKE} />
      <Path d="M8 11 V8 C8 5.8 9.8 4 12 4 C14.2 4 16 5.8 16 8 V11" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** An arrow pointing up: send. */
export function SendIcon({ color, size = 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 19 V5 M6 11 L12 5 L18 11" stroke={color} {...STROKE} strokeWidth={2.5} />
    </Svg>
  );
}
