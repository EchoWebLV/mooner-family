// The app's icons, on a 24-unit grid with one stroke: the tabs (22 px, in the tab's tint), and
// the small ones the screens use (back, chat, share, tick, padlock, send, trophy, settings,
// info, copy, crown).
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

/** A person, outlined: a head over shoulders. */
export function MeIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8} r={4} stroke={color} {...STROKE} />
      <Path d="M4 21 C4 16.6 7.6 13 12 13 C16.4 13 20 16.6 20 21" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A plus in a rounded square: create. */
export function PlusIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={3} width={18} height={18} rx={5} stroke={color} {...STROKE} />
      <Path d="M12 8 V16 M8 12 H16" stroke={color} {...STROKE} />
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

/** Three dots joined by two lines: share. */
export function ShareIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={18} cy={5.5} r={2.5} stroke={color} {...STROKE} />
      <Circle cx={6} cy={12} r={2.5} stroke={color} {...STROKE} />
      <Circle cx={18} cy={18.5} r={2.5} stroke={color} {...STROKE} />
      <Path d="M8.2 10.8 L15.8 6.7 M8.2 13.2 L15.8 17.3" stroke={color} {...STROKE} />
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

/** A cup on a stand: the ranks. */
export function TrophyIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 21 H16 M12 17 V21 M7 4 H17 V9 C17 11.8 14.8 14 12 14 C9.2 14 7 11.8 7 9 Z" stroke={color} {...STROKE} />
      <Path d="M7 6 H5 C3.9 6 3 6.9 3 8 C3 9.7 4.3 11 6 11 H7.3 M17 6 H19 C20.1 6 21 6.9 21 8 C21 9.7 19.7 11 18 11 H16.7" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A gear: settings. */
export function SettingsIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"
        stroke={color}
        {...STROKE}
      />
      <Circle cx={12} cy={12} r={3} stroke={color} {...STROKE} />
    </Svg>
  );
}

/** An i in a circle: how it works. */
export function InfoIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} {...STROKE} />
      <Path d="M12 11 V16 M12 8 V8.01" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Two sheets, one over the other: copy. */
export function CopyIcon({ color, size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={8} y={8} width={12} height={12} rx={2} stroke={color} {...STROKE} />
      <Path d="M16 8 V6 C16 4.9 15.1 4 14 4 H6 C4.9 4 4 4.9 4 6 V14 C4 15.1 4.9 16 6 16 H8" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A crown: first place. Filled, so it reads at a small size. */
export function CrownIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 18 L3 7 L8.5 11 L12 5 L15.5 11 L21 7 L20 18 Z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </Svg>
  );
}
