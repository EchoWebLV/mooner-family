// A launched coin: its chart, market cap, price, liquidity, volume, curve, holders and launch
// time, your position, its mint to copy, its links, the seat this phone joined with, and
// sticky Buy and Sell buttons. `key` is the coin's presale.
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, ScrollView, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { PriceChart } from "../../src/launched/PriceChart";
import {
  atMigration, capText, coinScreenState, curveOf, dayTime, holderRows, holdersText, inWith, liquidityText, positionOf, priceText, volumeText,
} from "../../src/launched/coin";
import { lockEnds } from "../../src/launched/trade";
import { TradeSheet } from "../../src/launched/TradeSheet";
import { CoinImage } from "../../src/ui/CoinImage";
import { FillBar } from "../../src/ui/FillBar";
import { shortWallet, solText } from "../../src/ui/format";
import { Button, Card, Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { TopBar } from "../../src/ui/TopBar";
import { Move } from "../../src/ui/motion";
import { C, S } from "../../src/ui/theme";
import { useAccount, useSigner } from "../../src/wallet";

/** How long "Copied" shows after a copy. */
const COPIED_MS = 2_000;
/** Where back goes when the coin was opened from a link: Pulse. */
const HOME = "/(tabs)";

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
  const mint = row?.mint;
  const stats = useStore(store, (s) => (mint ? s.coins[mint] : undefined));
  const statsMissing = useStore(store, (s) => (mint ? !!s.coinMissing[mint] : false));
  const statsError = useStore(store, (s) => (mint ? s.coinError[mint] : undefined));
  const holding = useStore(store, (s) => (mint ? s.holdings[mint] : undefined));
  const lamports = useStore(store, (s) => s.lamports);
  const seenAt = useStore(store, (s) => (mint ? s.launchSeen[mint] : undefined));
  const account = useAccount(); // undefined while the saved wallet is read on a cold start
  const signer = useSigner();
  const [sheet, setSheet] = useState(null); // "buy" | "sell" | null
  // what the last trade here did, and which trade it was: two trades can read the same
  // (tokensText rounds), and each one's card rises in again
  const [done, setDone] = useState(null); // { text, n } | null
  const onDone = useCallback((text) => {
    setDone((d) => ({ text, n: (d?.n ?? 0) + 1 }));
    AccessibilityInfo.announceForAccessibility(text);
  }, []);
  const shows = coinScreenState({ row, loaded, view });
  const token = row?.token;
  const youWereIn = inWith(detail, wallet, mine);
  const position = positionOf(holding, row?.pool?.sqrtPrice, solUsd);

  // the coin's stats and this wallet's balance of it, while this screen is the one in front:
  // the server lets a socket watch 4 coins, and a coin screen left behind in the stack lets
  // go of its own. The last stats stay in the store, so coming back shows them until the
  // new snapshot.
  useFocusEffect(useCallback(() => (mint ? store.getState().watchCoin(mint) : undefined), [mint]));

  return (
    <Screen padded={false}>
      <TopBar title={token ? `$${token.symbol}` : ""} fallback={HOME} />
      {shows === "coin" ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: S.gutter, paddingBottom: 32, gap: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <CoinImage uri={token.image} size={72} ticker={token.symbol} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <T v="h2" numberOfLines={2}>{token.name}</T>
              <T v="num" color={C.text1}>{`$${token.symbol}`}</T>
            </View>
          </View>
          <PriceChart stats={stats} missing={statsMissing} error={statsError} sqrtPrice={atMigration(row.pool) ? null : row.pool?.sqrtPrice} />
          {done ? (
            <Move kind="rise" key={done.n}>
              <Card>
                <T color={C.up}>{done.text}</T>
              </Card>
            </Move>
          ) : null}
          {position ? (
            <Move kind="rise">
              <Card style={{ gap: 6 }}>
                <T v="label">{`Your $${token.symbol}`}</T>
                <T v="num">{position.tokens}</T>
                {position.sol ? <T v="small">{position.usd ? `${position.sol} · ${position.usd}` : position.sol}</T> : null}
                {position.sol && atMigration(row.pool) ? <T v="small" color={C.text2}>At migration</T> : null}
              </Card>
            </Move>
          ) : null}
          <Stats row={row} stats={stats} statsDone={!!stats || statsMissing || !!statsError} solUsd={solUsd} />
          <Holders stats={stats} wallet={wallet} />
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
      {shows === "coin" && account !== undefined ? (
        <TradeBar
          row={row}
          seenAt={seenAt}
          signer={signer}
          sheet={sheet}
          setSheet={setSheet}
          onDone={onDone}
          holding={holding}
          lamports={lamports}
        />
      ) : null}
    </Screen>
  );
}

/** The sticky Buy and Sell buttons and their sheets; "Connect to trade" without a wallet. A
 *  sheet's close closes only that sheet: a trade that lands after its sheet was closed
 *  mustn't close the other one. `seenAt`: store launchSeen for the coin. */
function TradeBar({ row, seenAt, signer, sheet, setSheet, onDone, holding, lamports }) {
  const insets = useSafeAreaInsets();
  const opensAt = lockEnds(row, seenAt);
  const closeBuy = useCallback(() => setSheet((s) => (s === "buy" ? null : s)), [setSheet]);
  const closeSell = useCallback(() => setSheet((s) => (s === "sell" ? null : s)), [setSheet]);
  const sheets = { row, holding, lamports, signer, opensAt, onDone };
  return (
    <View
      style={{
        flexDirection: "row", gap: 12, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg0,
        paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: insets.bottom + 12,
      }}
    >
      {signer ? (
        <>
          <View style={{ flex: 1 }}>
            <Button title="Buy" onPress={() => setSheet("buy")} disabled={!row.pool} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Sell" kind="quiet" onPress={() => setSheet("sell")} disabled={!row.pool} />
          </View>
          <TradeSheet side="buy" open={sheet === "buy"} onClose={closeBuy} {...sheets} />
          <TradeSheet side="sell" open={sheet === "sell"} onClose={closeSell} {...sheets} />
        </>
      ) : (
        <Button title="Connect to trade" onPress={() => router.push("/connect")} />
      )}
    </View>
  );
}

/** Market cap, price, liquidity, 24h volume, curve and launch time, two to a row. Until the
 *  pool is read the pool's figures say "Pool loading"; until the stats came (or the server
 *  said it has none), theirs say "Loading". A migrated coin's price is the one at
 *  migration (and says so) until the server has found its DAMM v2 pool; from then on it's
 *  that pool's live price. A figure no source has says "Not known yet". */
function Stats({ row, stats, statsDone, solUsd }) {
  const pool = row.pool;
  const sqrt = pool?.sqrtPrice;
  const curve = pool ? curveOf(pool) : null;
  const liquidity = liquidityText(pool, stats);
  const volume = volumeText(stats);
  const atMigrationNote = atMigration(pool) ? <T v="small" color={C.text2}>At migration</T> : null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Market cap">
          {sqrt ? (
            <>
              <T v="num">{capText(sqrt, solUsd)}</T>
              {atMigrationNote}
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
        <Stat label="Price">
          {sqrt ? (
            <>
              <T v="num">{priceText(sqrt)}</T>
              {atMigrationNote}
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Liquidity">{!pool ? <PoolLoading /> : liquidity == null && !statsDone ? <Loading /> : <Figure text={liquidity} />}</Stat>
        <Stat label="24h volume">{statsDone ? <Figure text={volume} /> : <Loading />}</Stat>
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
const Loading = () => <T v="small" color={C.text2}>Loading</T>;

/** A figure, or "Not known yet" when no source has it. */
const Figure = ({ text }) => (text != null ? <T v="num">{text}</T> : <T v="small" color={C.text2}>Not known yet</T>);

/** The top holders read from chain (the curve, the pool and the presale by name), each with
 *  their tokens and, when the server read the supply, their share; and the holder count once
 *  Meteora has one. Nothing while they're read; a line when the server couldn't read them. */
function Holders({ stats, wallet }) {
  if (!stats) return null;
  const rows = holderRows(stats.top, wallet, stats.supply);
  const count = holdersText(stats);
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <T v="label">Top holders</T>
        {count ? <T v="small">{count}</T> : null}
      </View>
      {rows == null ? (
        <T v="small" color={C.text2}>Couldn't read the holders right now</T>
      ) : rows.length === 0 ? (
        <T v="small" color={C.text2}>No holders yet</T>
      ) : (
        rows.map((h) => (
          <View key={h.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <T numberOfLines={1} style={{ flexShrink: 1 }} color={h.who === "You" ? C.accent : C.text0}>{h.who}</T>
            <T v="num">{h.share ? `${h.tokens} · ${h.share}` : h.tokens}</T>
          </View>
        ))
      )}
    </Card>
  );
}

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
