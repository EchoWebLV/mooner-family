// A launched coin: its market cap, price, curve and launch time, its mint to copy, its links,
// and the seat this phone joined with. `key` is the coin's presale.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { capText, coinScreenState, curveOf, dayTime, inWith, priceText } from "../../src/launched/coin";
import { CoinImage } from "../../src/ui/CoinImage";
import { FillBar } from "../../src/ui/FillBar";
import { shortWallet, solText } from "../../src/ui/format";
import { Card, Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { TopBar } from "../../src/ui/TopBar";
import { C, S } from "../../src/ui/theme";

/** How long "Copied" shows after a copy. */
const COPIED_MS = 2_000;
/** Where back goes when the coin was opened from a link: the Launched tab. */
const LAUNCHED = "/(tabs)/launched";

export default function Coin() {
  const params = useLocalSearchParams();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  const row = useStore(store, (s) => s.launched[key]);
  const view = useStore(store, (s) => s.views[key] ?? s.presales[key]);
  const detail = useStore(store, (s) => s.views[key]);
  const wallet = useStore(store, (s) => s.wallet);
  const mine = useStore(store, (s) => s.mine[key]);
  const solUsd = useStore(store, (s) => s.solUsd);
  const loaded = useStore(store, (s) => s.loaded.launched);
  const feedError = useStore(store, (s) => s.feedError.launched);
  const shows = coinScreenState({ row, loaded, view });
  const token = row?.token;
  const youWereIn = inWith(detail, wallet, mine);

  return (
    <Screen padded={false}>
      <TopBar title={token ? `$${token.symbol}` : ""} fallback={LAUNCHED} />
      {shows === "coin" ? (
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
          <LinkPills token={token} />
          {token.description ? <T color={C.text1}>{token.description}</T> : null}
          {youWereIn != null ? (
            <Card>
              <T>{`You were in with ${solText(youWereIn)} SOL`}</T>
            </Card>
          ) : null}
        </ScrollView>
      ) : shows === "missing" ? (
        <Empty title="This coin isn't listed" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {feedError ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{feedError}</T> : null}
        </View>
      )}
    </Screen>
  );
}

/** Market cap, price, curve and launch time, two to a row. Until the pool is read the pool's
 *  three say "Pool loading". Once the pool has migrated, its DBC price stopped moving: the
 *  cap and price are the ones at migration and say so. */
function Stats({ row, solUsd }) {
  const pool = row.pool;
  const sqrt = pool?.sqrtPrice;
  const curve = pool ? curveOf(pool) : null;
  const atMigration = pool?.migrated ? <T v="small" color={C.text2}>At migration</T> : null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Market cap">
          {sqrt ? (
            <>
              <T v="num">{capText(sqrt, solUsd)}</T>
              {atMigration}
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
        <Stat label="Price">
          {sqrt ? (
            <>
              <T v="num">{priceText(sqrt)}</T>
              {atMigration}
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
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

/** The mint, short, and "Copy": then "Copied" for COPIED_MS, or an error buzz if the copy
 *  didn't take. */
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
    Clipboard.setStringAsync(mint).then(
      () => {
        if (!alive.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
    );
  };

  return (
    <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ gap: 4 }}>
        <T v="label">Mint</T>
        <T v="num">{shortWallet(mint)}</T>
      </View>
      <PillButton
        title={copied ? "Copied" : "Copy"}
        accessibilityLabel={copied ? "Copied" : "Copy the mint"}
        color={copied ? C.up : C.text0}
        live
        onPress={copy}
      />
    </Card>
  );
}
