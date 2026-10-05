// The phone's building blocks, in the website's look (theme.js): near-black surfaces, hairline
// rims, one blue for actions, ovals for buttons.
import { ActivityIndicator, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useNavigation } from "expo-router";
import { useEffect, useRef } from "react";
import { isArmed, play } from "./sound";
import { C, F, R, S } from "./theme";

/** "#rrggbb" at an alpha of 0..1 ("#rrggbb66"); anything else comes back as it was. */
const withAlpha = (color, a) =>
  /^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(a * 255).toString(16).padStart(2, "0")}` : color;

/** A screen on the dark base, below the status bar. `scroll` makes the content scroll. */
export function Screen({ children, scroll = false, padded = true }) {
  const pad = padded ? S.gutter : 0;
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: C.bg0 }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 32 }}>{children}</ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: pad }}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const VARIANTS = {
  title: { fontFamily: F.semi, fontSize: 28 },
  h2: { fontFamily: F.semi, fontSize: 20 },
  body: { fontFamily: F.regular, fontSize: 15 },
  small: { fontFamily: F.regular, fontSize: 13, color: C.text1 },
  label: { fontFamily: F.medium, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: C.text2 },
  num: { fontFamily: F.mono, fontSize: 15 },
  bigNum: { fontFamily: F.mono, fontSize: 34 },
};

/** Text: v is title, h2, body, small, label, num or bigNum. */
export function T({ v = "body", color, style, children, ...rest }) {
  return (
    <Text {...rest} style={[{ color: C.text0 }, VARIANTS[v], color && { color }, style]}>
      {children}
    </Text>
  );
}

const BUTTONS = {
  primary: { bg: C.accent, ink: C.accentInk, rim: C.accent },
  quiet: { bg: C.bg2, ink: C.text0, rim: C.lineStrong },
  danger: { bg: "transparent", ink: C.down, rim: C.down },
  gold: { bg: C.gold, ink: C.goldInk, rim: C.gold },
  up: { bg: C.up, ink: C.bg0, rim: C.up },
};

/** An oval, full-width button. kind is primary, quiet, danger, gold or up; busy swaps the title for a spinner. */
export function Button({ title, onPress, kind = "primary", disabled, busy, icon }) {
  const b = BUTTONS[kind];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={(e) => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          height: 52, width: "100%", borderRadius: R.pill, backgroundColor: b.bg,
          borderWidth: 1, borderColor: b.rim, alignItems: "center", justifyContent: "center",
          flexDirection: "row", gap: 8,
        },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={b.ink} />
      ) : (
        <>
          {icon ?? null}
          <Text style={{ fontFamily: F.semi, fontSize: 16, color: b.ink }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** A panel: bg1, a hairline rim, round corners. Pressable when onPress is given: then it's a
 *  button, and `accessibilityLabel` is what a screen reader says for it. */
export function Card({ children, onPress, style, accessibilityLabel }) {
  const base = { backgroundColor: C.bg1, borderRadius: R.l, borderWidth: 1, borderColor: C.line, padding: 14 };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

/** A small quiet oval button that hugs its title ("Connect", "Copy"). `color` tints the
 *  title; `accessibilityLabel` defaults to it. `live` makes a screen reader say the new
 *  label when it changes ("Copied"). */
export function PillButton({ title, onPress, color = C.text0, accessibilityLabel, live }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityLiveRegion={live ? "polite" : undefined}
      hitSlop={8}
      onPress={(e) => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          height: 34, paddingHorizontal: 14, borderRadius: R.pill, backgroundColor: C.bg2,
          borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={{ fontFamily: F.semi, fontSize: 14, color }}>{title}</Text>
    </Pressable>
  );
}

/** A small rounded tag; the rim is the colour at 40%. Hugs its text in a column or a row. */
export function Pill({ text, color = C.text1 }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <View
        style={{
          borderRadius: R.pill, borderWidth: 1, borderColor: withAlpha(color, 0.4),
          paddingHorizontal: 8, paddingVertical: 2,
        }}
      >
        <Text style={{ fontFamily: F.medium, fontSize: 12, color }}>{text}</Text>
      </View>
    </View>
  );
}

/** A thin strip across the top, for "Reconnecting…". */
export function Banner({ text, color = C.warn }) {
  return (
    <View style={{ height: 28, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.bg0 }}>{text}</Text>
    </View>
  );
}

/** What a flow is doing right now ("Signing"), with a spinner; null shows nothing. */
export function Steps({ step }) {
  if (step == null) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ActivityIndicator size="small" color={C.text1} />
      <T v="small">{`${step}…`}</T>
    </View>
  );
}

/** A panel that slides up from the bottom; a tap on the dimmed backdrop closes it. It plays
 *  `sheet` when it opens, lower and faster when it closes: only after the first touch, with
 *  the app in front and its screen focused (a sheet closed by a trade that lands elsewhere
 *  stays quiet). Use it inside a screen: it reads the screen's navigation. */
export function Sheet({ open, onClose, children, title }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const was = useRef(!!open);
  useEffect(() => {
    if (was.current === !!open) return;
    was.current = !!open;
    if (isArmed() && navigation.isFocused() && AppState.currentState === "active") play("sheet", { close: !open });
  }, [open, navigation]);
  return (
    <Modal visible={!!open} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.6)" }]}
        />
        <View
          style={{
            backgroundColor: C.bg1, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderTopWidth: 1, borderColor: C.line, paddingHorizontal: S.gutter, paddingTop: 10,
            paddingBottom: insets.bottom + 16, maxHeight: "90%",
          }}
        >
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.lineStrong, marginBottom: 14 }} />
          {title ? <T v="h2" style={{ marginBottom: 12 }}>{title}</T> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** What an empty list says. */
export function Empty({ title, body }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 6 }}>
      <T v="h2" color={C.text1} style={{ textAlign: "center" }}>{title}</T>
      {body ? <T v="small" color={C.text2} style={{ textAlign: "center" }}>{body}</T> : null}
    </View>
  );
}
