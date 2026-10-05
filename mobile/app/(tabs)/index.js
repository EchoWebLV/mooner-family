// Pulse: three lanes you swipe between (New Pairs, Final Stretch, Migrated), from the presales
// and launched feeds the server pushes. Quiet but for a tap when the lane changes; cards and
// lane counts only fade in, once.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { GRAD_SOL, stageOf } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { MarketCard } from "../../src/launched/MarketCard";
import { EXPIRED_STAYS_MS, expiredSeen, filling, finalStretch, migrated, newPairs } from "../../src/live/lanes";
import { PresaleCard } from "../../src/live/PresaleCard";
import { solText } from "../../src/ui/format";
import { Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { FadeOnce, Move } from "../../src/ui/motion";
import { play } from "../../src/ui/sound";
import { C, F, S } from "../../src/ui/theme";

const LANES = [
  { id: "new", title: "New Pairs", empty: "No presales right now", body: "New ones show up here the moment they open." },
  { id: "final", title: "Final Stretch", empty: "No coins on the curve", body: "Coins land here the moment their presale fills." },
  { id: "migrated", title: "Migrated", empty: "Nothing migrated yet", body: `Coins move here when their curve reaches ${GRAD_SOL} SOL.` },
];

export default function Pulse() {
  const presales = useStore(store, (s) => s.presales);
  const launched = useStore(store, (s) => s.launched);
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const presalesLoaded = useStore(store, (s) => s.loaded.presales);
  const launchedLoaded = useStore(store, (s) => s.loaded.launched);
  const presalesError = useStore(store, (s) => s.feedError.presales);
  const launchedError = useStore(store, (s) => s.feedError.launched);
  const wallet = useStore(store, (s) => s.wallet);
  const solUsd = useStore(store, (s) => s.solUsd);

  // When each presale was first seen expired (lanes.js expiredSeen). Set before paint, so an
  // expired card never shows for a frame; the ones expired at the first read never show.
  const [seen, setSeen] = useState({});
  const primed = useRef(false);
  useLayoutEffect(() => {
    if (!presalesLoaded) return;
    const at = primed.current ? Date.now() : -Infinity;
    primed.current = true;
    setSeen((s) => expiredSeen(s, presales, launched, at));
  }, [presales, launched, presalesLoaded]);

  // Reads the lanes again when the next expired card's time is up; nothing ticks otherwise.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t0 = Date.now();
    const due = Object.values(seen)
      .filter(Number.isFinite)
      .map((t) => t + EXPIRED_STAYS_MS - t0)
      .filter((ms) => ms > 0);
    if (!due.length) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(...due));
    return () => clearTimeout(t);
  }, [seen, now]);

  const lists = useMemo(
    () => ({ new: newPairs(presales, launched, now, seen), final: finalStretch(launched), migrated: migrated(launched) }),
    [presales, launched, now, seen],
  );
  const pool = useMemo(() => filling(presales, launched), [presales, launched]);

  // the lanes: a horizontal pager, one page per lane; a tap when the lane changes
  const [lane, setLane] = useState(0);
  const laneNow = useRef(0);
  const pager = useRef(null);
  const [pageW, setPageW] = useState(0);
  const show = useCallback((i) => {
    if (i === laneNow.current) return;
    laneNow.current = i;
    setLane(i);
    play("tap");
  }, []);
  const goTo = (i) => {
    show(i);
    pager.current?.scrollTo({ x: i * pageW, animated: true });
  };

  const presaleItem = useCallback(
    ({ item }) => (
      <FadeOnce id={`new:${item.presale}`}>
        <PresaleCard
          view={item}
          info={info}
          wallet={wallet}
          stage={stageOf(item, launched[item.presale])}
          onPress={() => router.push(`/presale/${item.presale}`)}
        />
      </FadeOnce>
    ),
    [info, wallet, launched],
  );
  const marketItem = (laneId) => ({ item }) => (
    <FadeOnce id={`${laneId}:${item.presale}`}>
      <MarketCard row={item} solUsd={solUsd} onPress={() => router.push(`/coin/${item.presale}`)} />
    </FadeOnce>
  );
  const finalItem = useCallback(marketItem("final"), [solUsd]);
  const migratedItem = useCallback(marketItem("migrated"), [solUsd]);

  const pages = [
    { lane: LANES[0], data: lists.new, renderItem: presaleItem, ready: !!info && presalesLoaded, error: infoError || presalesError },
    { lane: LANES[1], data: lists.final, renderItem: finalItem, ready: launchedLoaded, error: launchedError },
    { lane: LANES[2], data: lists.migrated, renderItem: migratedItem, ready: launchedLoaded, error: launchedError },
  ];

  return (
    <Screen padded={false}>
      <Header pool={pool} />
      <LaneTabs lane={lane} counts={{ new: lists.new.length, final: lists.final.length, migrated: lists.migrated.length }} onPick={goTo} />
      <View style={{ flex: 1 }} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
        {pageW > 0 ? (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => show(Math.round(e.nativeEvent.contentOffset.x / pageW))}
          >
            {pages.map((p) => (
              <Lane key={p.lane.id} width={pageW} {...p} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Screen>
  );
}

const Gap = () => <View style={{ height: 10 }} />;

/** One lane's list, or a spinner until its feed (and, for New Pairs, the pool size) is in. */
function Lane({ lane, data, renderItem, ready, error, width }) {
  return (
    <View style={{ width }}>
      {ready ? (
        <FlatList
          data={data}
          keyExtractor={(r) => r.presale}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: S.gutter }}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={error && data.length > 0 ? <T v="small" color={C.down} style={{ marginBottom: 10 }}>{error}</T> : null}
          ListEmptyComponent={<Empty title={lane.empty} body={error ? <T v="small" color={C.down}>{error}</T> : lane.body} />}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
        </View>
      )}
    </View>
  );
}

/** The three lanes' names and counts; the one shown is underlined in the ER colour. A new
 *  count fades in. */
function LaneTabs({ lane, counts, onPick }) {
  return (
    <View style={{ flexDirection: "row", marginHorizontal: S.gutter, borderBottomWidth: 1, borderColor: C.line }}>
      {LANES.map((l, i) => {
        const on = i === lane;
        return (
          <Pressable
            key={l.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${l.title}, ${counts[l.id]}`}
            onPress={() => onPick(i)}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
              paddingVertical: 10, marginBottom: -1, borderBottomWidth: 2, borderColor: on ? C.er : "transparent",
            }}
          >
            <T v="small" color={on ? C.text0 : C.text2} style={{ fontFamily: F.semi }}>{l.title}</T>
            <Move kind="fade" key={counts[l.id]}>
              <T v="small" color={C.text2} style={{ fontFamily: F.mono, fontSize: 11 }}>{String(counts[l.id])}</T>
            </Move>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Pulse" over "X SOL filling N pools", and on the right the wallet's SOL, or a small
 *  "Connect" with no wallet. */
function Header({ pool }) {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: 10, minHeight: 56,
      }}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <T v="title">Pulse</T>
        <T v="small" numberOfLines={1}>
          <T v="small" color={C.er} style={{ fontFamily: F.mono }}>{`${solText(pool.lamports)} SOL`}</T>
          {` filling ${pool.count} pool${pool.count === 1 ? "" : "s"}`}
        </T>
      </View>
      {!wallet ? (
        <PillButton title="Connect" onPress={() => router.push("/connect")} />
      ) : lamports == null ? (
        <ActivityIndicator size="small" color={C.text1} />
      ) : (
        <T v="num">{`${solText(lamports)} SOL`}</T>
      )}
    </View>
  );
}
