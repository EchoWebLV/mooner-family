// A launched coin: its market cap, price, curve and launch time, its mint to copy, its links,
// and the seat this phone joined with. `key` is the coin's presale.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { capText, curveOf, dayTime, priceText, stillIn } from "../../src/launched/coin";
import { BackIcon } from "../../src/room/icons";
import { linksOf } from "../../src/room/room";
import { CoinImage } from "../../src/ui/CoinImage";
import { FillBar } from "../../src/ui/FillBar";
import { shortWallet, solText } from "../../src/ui/format";
import { Card, Empty, Screen, T } from "../../src/ui/kit";
import { C, F, R, S } from "../../src/ui/theme";

/** How long "Copied" shows after a copy. */
const COPIED_MS = 2_000;

export default function Coin() {
  const { key } = useLocalSearchParams();
  const row = useStore(store, (s) => s.launched[key]);
  const mine = useStore(store, (s) => s.mine[key]);
  const solUsd = useStore(store, (s) => s.solUsd);
  const loaded = useStore(store, (s) => s.loaded.launched);
  const token = row?.token;

  return (
    <Screen padded={false}>
      <BackBar />
      {token ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: S.gutter, paddingBottom: 32, gap: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <CoinImage uri={token.image} size={72} ticker={token.symbol} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <T v="h2" numberOfLines={2}>{token.name}</T>
              <T v="num" color={C.text1}>{`$${token.symbol}`}</T>
            </View>
          </View>
          <Stats row={row} solUsd={solUsd} />
          <MintRow mint={row.mint} />
          <Links token={token} />
          {token.description ? <T color={C.text1}>{token.description}</T> : null}
          {stillIn(mine) ? (
            <Card>
              <T>{`You were in with ${solText(mine.deposit)} SOL`}</T>
            </Card>
          ) : null}
        </ScrollView>
      ) : loaded ? (
        <Empty title="This coin isn't listed" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.text1} />
        </View>
      )}
    </Screen>
  );
}

const goBack = () => (router.canGoBack() ? router.back() : router.replace("/launched"));

/** A back chevron above the screen; with nothing to go back to, it opens Launched. */
function BackBar() {
  return (
    <View style={{ height: 52, justifyContent: "center", paddingHorizontal: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={goBack}
        style={({ pressed }) => [
          { width: 40, height: 40, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
          pressed && { backgroundColor: C.bg2 },
        ]}
      >
        <BackIcon color={C.text0} />
      </Pressable>
    </View>
  );
}

/** Market cap, price, curve and launch time, two to a row. Until the pool is read the pool's
 *  three say "Pool loading". */
function Stats({ row, solUsd }) {
  const pool = row.pool;
  const sqrt = pool?.sqrtPrice;
  const curve = pool ? curveOf(pool) : null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Market cap">{sqrt ? <T v="num">{capText(sqrt, solUsd)}</T> : <PoolLoading />}</Stat>
        <Stat label="Price">{sqrt ? <T v="num">{priceText(sqrt)}</T> : <PoolLoading />}</Stat>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Curve">
          {curve ? (
            <>
              {pool.migrated ? <T v="small" color={C.migrated}>{curve.text}</T> : <T v="num">{curve.text}</T>}
              <FillBar fill={curve.fill} color={pool.migrated ? C.migrated : C.up} />
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
        <Stat label="Launched">{row.launch ? <T v="num">{dayTime(row.launch.at)}</T> : null}</Stat>
      </View>
    </View>
  );
}

/** One figure in the grid: a small label over its value. */
function Stat({ label, children }) {
  return (
    <Card style={{ flex: 1, gap: 8 }}>
      <T v="label">{label}</T>
      {children}
    </Card>
  );
}

const PoolLoading = () => <T v="small" color={C.text2}>Pool loading</T>;

/** The mint, short, and "Copy": a tick of haptics, then "Copied" for COPIED_MS. */
function MintRow({ mint }) {
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
    Clipboard.setStringAsync(mint).then(
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
    <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ gap: 4 }}>
        <T v="label">Mint</T>
        <T v="num">{shortWallet(mint)}</T>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy the mint"
        hitSlop={8}
        onPress={copy}
        style={({ pressed }) => [pillStyle, pressed && { opacity: 0.85 }]}
      >
        <T style={{ fontFamily: F.medium, fontSize: 14 }} color={copied ? C.up : C.text0}>{copied ? "Copied" : "Copy"}</T>
      </Pressable>
    </Card>
  );
}

/** The coin's X, Telegram and website, the ones it has, as pills that open them. */
function Links({ token }) {
  const links = linksOf(token);
  if (links.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {links.map(({ label, url }) => (
        <Pressable
          key={label}
          accessibilityRole="link"
          accessibilityLabel={label}
          onPress={() => Linking.openURL(url).catch(() => {})}
          style={({ pressed }) => [pillStyle, pressed && { opacity: 0.85 }]}
        >
          <T style={{ fontFamily: F.medium, fontSize: 14 }}>{label}</T>
        </Pressable>
      ))}
    </View>
  );
}

const pillStyle = {
  height: 34, paddingHorizontal: 14, borderRadius: R.pill, backgroundColor: C.bg2,
  borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
};
