// Me: the live picture with Settings (Sounds, Disconnect) on glass; your face, wallet and Copy;
// your balance and rank; your XP and the Seeker Genesis check; and your launches. With no
// wallet, the same Connect Seed Vault as the Connect screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, Switch, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { BOARD_TOP } from "../../../engine/src/xp.js";
import { store } from "../../src/app";
import { rowsOf } from "../../src/me";
import { useConnect } from "../../src/useConnect";
import { useAccount, useWalletActions } from "../../src/wallet";
import { CoinImage } from "../../src/ui/CoinImage";
import { Face } from "../../src/ui/Face";
import { Glass, SceneHeader } from "../../src/ui/Glass";
import { CheckIcon, CopyIcon, SettingsIcon } from "../../src/ui/icons";
import { Logo } from "../../src/ui/Logo";
import { setSoundsOn, useSoundsOn } from "../../src/ui/sound";
import { shortWallet, solText, usd } from "../../src/ui/format";
import { Button, Card, Empty, Pill, Sheet, T } from "../../src/ui/kit";
import { C, F, S } from "../../src/ui/theme";
import { XpCard } from "../../src/xp/XpCard";
import { rankOf } from "../../src/xp/rows";

/** How long the tick shows after a copy. */
const COPIED_MS = 2_000;

/** The picture's height, the status bar's room included. */
const SCENE_PT = 150;

/** Your face's size; half of it hangs over the picture's bottom edge. */
const FACE_PT = 92;

/** The status pill's colour for each kind of row (me.js statusOf). */
const PILL = { launched: C.gold, back: C.text1, in: C.up, closed: C.text2 };

export default function Me() {
  const wallet = useStore(store, (s) => s.wallet);
  const account = useAccount();
  const { disconnect } = useWalletActions();
  const [leaving, setLeaving] = useState(false);
  const leavingNow = useRef(false); // set at once, so a second tap before the re-render does nothing
  const [settings, setSettings] = useState(false);
  const openSettings = useCallback(() => setSettings(true), []);
  // a sheet left open by a wallet that went must not open again for the next one
  useEffect(() => {
    if (!wallet) setSettings(false);
  }, [wallet]);

  // The store forgets the wallet first; if the adapter then fails to, Connect is still the
  // right place to go and there's nothing for the person to do about it.
  async function signOut() {
    if (leavingNow.current) return;
    leavingNow.current = true;
    setLeaving(true);
    try {
      await store.getState().signOut();
      await disconnect().catch(() => {});
      router.replace("/connect"); // replaces the tabs, so the guard goes with this screen
    } catch (e) {
      leavingNow.current = false;
      setLeaving(false);
      throw e;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      {wallet ? (
        // keyed: a new wallet's page starts fresh (the Genesis row's busy and error with it)
        <Wallet key={wallet} wallet={wallet} onSettings={openSettings} />
      ) : (
        <>
          <SceneHeader name="live" height={SCENE_PT} motion="lift" title="Me" />
          {account === undefined || leaving ? <Loading /> : <SignedOut />}
        </>
      )}
      <Sheet open={settings && !!wallet} onClose={() => setSettings(false)} title="Settings">
        <View style={{ gap: 16 }}>
          <SoundsRow />
          <Button title="Disconnect" kind="quiet" busy={leaving} onPress={signOut} />
        </View>
      </Sheet>
    </View>
  );
}

const Gap = () => <View style={{ height: 12 }} />;

const Loading = () => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
    <ActivityIndicator color={C.text1} />
  </View>
);

/** No wallet: the logo, what connecting gives, and Connect Seed Vault. Once connected, Me
 *  turns into the wallet's page (this unmounts, so it opens fresh next time). */
function SignedOut() {
  const { connect, busy, error } = useConnect();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: S.gutter, paddingBottom: 32 }}>
      <Logo size={96} />
      <T v="body" color={C.text1} style={{ textAlign: "center" }}>Connect your wallet to see your launches</T>
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Button title="Connect Seed Vault" onPress={connect} busy={busy} />
      <View style={{ alignSelf: "stretch" }}>
        <SoundsRow />
      </View>
    </View>
  );
}

/** The wallet's page, all in one list so it scrolls: the scene with the gear, you, your
 *  balance and rank, your XP, then your launches. The phone draws edge to edge, so the status
 *  bar is see-through: a bg0 scrim fills in under it as the picture scrolls away, solid by the
 *  time your face gets there, so the rows never show under the clock. */
function Wallet({ wallet, onSettings }) {
  const presales = useStore(store, (s) => s.presales);
  const views = useStore(store, (s) => s.views);
  const launched = useStore(store, (s) => s.launched);
  const mine = useStore(store, (s) => s.mine);
  const presalesLoaded = useStore(store, (s) => s.loaded.presales);
  const launchedLoaded = useStore(store, (s) => s.loaded.launched);
  const ready = presalesLoaded && launchedLoaded;
  const rows = useMemo(() => rowsOf({ wallet, presales, views, launched, mine }), [wallet, presales, views, launched, mine]);
  const renderItem = useCallback(
    ({ item }) => (
      <View style={{ paddingHorizontal: S.gutter }}>
        <PresaleRow row={item} ready={ready} />
      </View>
    ),
    [ready],
  );

  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  if (!scrollRef.current) scrollRef.current = new Animated.Value(0);
  const scrollY = scrollRef.current;
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  const scrim = useMemo(() => {
    const solidAt = Math.max(1, SCENE_PT - FACE_PT / 2 - insets.top); // your face's top reaches the clock
    return scrollY.interpolate({ inputRange: [0, solidAt], outputRange: [0, 1], extrapolate: "clamp" });
  }, [scrollY, insets.top]);
  // built once per wallet: a push to the launches' feeds redraws the rows, not all of this
  // (each part reads the store on its own)
  const header = useMemo(
    () => (
      <View>
        <SceneHeader
          name="live"
          height={SCENE_PT}
          motion="lift"
          title="Me"
          right={
            <Glass label="Settings" onPress={onSettings}>
              <SettingsIcon color={C.text0} size={20} />
            </Glass>
          }
        />
        <View style={{ paddingHorizontal: S.gutter, gap: 12 }}>
          <You wallet={wallet} />
          <Boxes wallet={wallet} />
          <XpCard wallet={wallet} />
          <T v="label" style={{ marginTop: 12, marginBottom: 0 }}>Your launches</T>
        </View>
        <View style={{ height: 12 }} />
      </View>
    ),
    [wallet, onSettings],
  );

  return (
    <View style={{ flex: 1 }}>
      <Animated.FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 32 }}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty title="You're not in any launch yet" body="Chip in to one from Pulse." />}
      />
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: C.bg0, opacity: scrim }}
      />
    </View>
  );
}

/** Your face (gold ring) over the scene's bottom edge, your short wallet and Copy. */
function You({ wallet }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14, marginTop: -FACE_PT / 2 }}>
      <Face wallet={wallet} size={FACE_PT} ring={C.gold} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 }}>
        <T v="num" style={{ fontSize: 17 }}>{shortWallet(wallet)}</T>
        <CopyButton text={wallet} label="Copy the wallet address" />
      </View>
    </View>
  );
}

/** A box's number: one line that shrinks to fit, growing with the text size up to 1.3x. */
const BoxNum = ({ children }) => (
  <T numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3} style={{ fontFamily: F.mono, fontSize: 20 }}>
    {children}
  </T>
);

/** Balance ("2.41 SOL", ≈ dollars when the price is known) and Rank on Overall (rows.js
 *  rankOf: "#14" over "of N" or "of 500+"; "500+" past the board; "–" until the XP rows and
 *  yours are here; "Not ranked" with no XP). Rank opens Ranks. */
function Boxes({ wallet }) {
  const lamports = useStore(store, (s) => s.lamports);
  const solUsd = useStore(store, (s) => s.solUsd);
  const xp = useStore(store, (s) => s.xp);
  const xpLoaded = useStore(store, (s) => s.xpLoaded);
  const rank = useMemo(() => rankOf(xp, "overall", wallet, xpLoaded), [xp, wallet, xpLoaded]);
  const known = lamports != null;
  const dollars = known && solUsd > 0 ? usd((lamports / 1e9) * solUsd) : null;
  const balance = known ? `Balance ${solText(lamports)} SOL${dollars ? `, about ${dollars}` : ""}` : "Balance: not read yet";
  let value;
  let label;
  if (rank.kind === "ranked") {
    value = <BoxNum>{`#${rank.rank}`}</BoxNum>;
    label = `Rank ${rank.rank} of ${rank.of}`;
  } else if (rank.kind === "past") {
    value = <BoxNum>{`${BOARD_TOP}+`}</BoxNum>;
    label = `Rank: outside the top ${BOARD_TOP}`;
  } else if (rank.kind === "none") {
    value = <T v="small" color={C.text1}>Not ranked</T>;
    label = "Rank: not ranked";
  } else {
    value = <BoxNum>–</BoxNum>;
    label = "Rank: not read yet";
  }
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Card style={{ flex: 1 }}>
        <View accessible accessibilityLabel={balance} style={{ gap: 4 }}>
          <T v="label">Balance</T>
          <BoxNum>{known ? `${solText(lamports)} SOL` : "–"}</BoxNum>
          {dollars ? <T v="small">{`≈ ${dollars}`}</T> : null}
        </View>
      </Card>
      <Card style={{ flex: 1, gap: 4 }} onPress={() => router.push("/ranks")} accessibilityLabel={label}>
        <T v="label">Rank</T>
        {value}
        {rank.kind === "ranked" ? <T v="small">{`of ${rank.of}`}</T> : null}
      </Card>
    </View>
  );
}

/** Copy: a round button with the copy icon. A tick of haptics, `text` on the clipboard, then
 *  a green tick (and "Copied" for a screen reader) for COPIED_MS. */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const copy = () => {
    Haptics.selectionAsync().catch(() => {});
    Clipboard.setStringAsync(text).then(
      () => {
        if (!alive.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {},
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      accessibilityLiveRegion="polite"
      hitSlop={8}
      onPress={copy}
      style={({ pressed }) => [
        {
          width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg2,
          borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      {copied ? <CheckIcon color={C.up} size={14} /> : <CopyIcon color={C.text1} size={16} />}
    </Pressable>
  );
}

/** One of the wallet's presales: its coin (its short key while the coin isn't known yet) and
 *  where the wallet stands, once `ready` (both feeds loaded: before that every row would read
 *  Closed). A tap opens the presale, or the coin once it launched. */
function PresaleRow({ row, ready }) {
  const { key, token, status } = row;
  return (
    <Card
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        router.push(status.to);
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CoinImage uri={token?.image} size={40} ticker={token?.symbol} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {token ? (
            <T v="h2" numberOfLines={1}>{`$${token.symbol}`}</T>
          ) : (
            <T v="num" color={C.text2} numberOfLines={1}>{shortWallet(key)}</T>
          )}
        </View>
        {ready ? <Pill text={status.text} color={PILL[status.kind]} /> : null}
      </View>
    </Card>
  );
}

/** "Sounds" and its switch, on by default and kept on the phone (sound.js). */
function SoundsRow() {
  const on = useSoundsOn();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <T v="body">Sounds</T>
      <Switch
        accessibilityLabel="Sounds"
        value={on}
        onValueChange={setSoundsOn}
        trackColor={{ false: C.bg3, true: C.accent }}
        thumbColor={C.text0}
      />
    </View>
  );
}
