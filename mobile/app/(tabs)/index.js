// Pulse: three lanes you swipe between (New Pairs, Final Stretch, Migrated), from the presales
// and launched feeds the server pushes. Quiet but for a tap when the lane changes; cards and
// lane counts only fade in, once.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { GRAD_SOL } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { MarketCard } from "../../src/launched/MarketCard";
import { EXPIRED_STAYS_MS, expiredSeen, filling, finalStretch, migrated, newPairs, settledLane } from "../../src/live/lanes";
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

  // final and migrated read only the launched feed; each card gets its row (New Pairs: the
  // presales row and its stage), so a push re-renders only the cards whose rows it changed
  const pairs = useMemo(() => newPairs(presales, launched, now, seen), [presales, launched, now, seen]);
  const onCurve = useMemo(() => finalStretch(launched), [launched]);
  const moved = useMemo(() => migrated(launched), [launched]);
  const pool = useMemo(() => filling(presales, launched), [presales, launched]);
  // counts and the SOL filling read both feeds (stageOf takes the launched row): nothing until
  // they're in, so no 0 shows and then jumps
  const bothLoaded = presalesLoaded && launchedLoaded;
  const counts = useMemo(
    () => ({
      new: bothLoaded ? pairs.length : null,
      final: launchedLoaded ? onCurve.length : null,
      migrated: launchedLoaded ? moved.length : null,
    }),
    [bothLoaded, launchedLoaded, pairs.length, onCurve.length, moved.length],
  );

  // the lanes: a horizontal pager, one page per lane; one tap when the lane changes
  const [lane, setLane] = useState(0);
  const laneNow = useRef(0);
  const pager = useRef(null);
  // The lane a tab tap is scrolling to, until the scroll lands there or the user drags: a
  // cancelled scroll's momentum end isn't a lane change (lanes.js settledLane).
  const target = useRef(null);
  const [pageW, setPageW] = useState(0);
  const show = useCallback((i) => {
    if (i === laneNow.current) return;
    laneNow.current = i;
    setLane(i);
    play("tap");
  }, []);
  const goTo = useCallback(
    (i) => {
      target.current = i;
      show(i);
      pager.current?.scrollTo({ x: i * pageW, animated: true });
    },
    [show, pageW],
  );
  const onDrag = useCallback(() => {
    target.current = null;
  }, []);
  const onSettle = useCallback(
    (e) => {
      const i = settledLane(e.nativeEvent.contentOffset.x, pageW, target.current);
      if (i == null) return;
      target.current = null;
      show(i);
    },
    [show, pageW],
  );
  // a new width (split screen, rotation) keeps the lane shown, without a sound
  useEffect(() => {
    if (pageW <= 0) return;
    target.current = null;
    pager.current?.scrollTo({ x: laneNow.current * pageW, animated: false });
  }, [pageW]);

  const presaleItem = useCallback(
    ({ item }) => (
      <FadeOnce id={`new:${item.presale}`}>
        <PresaleCard view={item.view} info={info} wallet={wallet} stage={item.stage} onPress={openPresale} />
      </FadeOnce>
    ),
    [info, wallet],
  );
  const finalItem = useMemo(() => marketItem("final", solUsd), [solUsd]);
  const migratedItem = useMemo(() => marketItem("migrated", solUsd), [solUsd]);

  // Lane is memoized and gets these spread as props: each stays the same until its lane's
  // data, feed state or the solUsd its cards show changes
  const pages = [
    { lane: LANES[0], data: pairs, renderItem: presaleItem, ready: !!info && presalesLoaded, error: infoError || presalesError },
    { lane: LANES[1], data: onCurve, renderItem: finalItem, ready: launchedLoaded, error: launchedError },
    { lane: LANES[2], data: moved, renderItem: migratedItem, ready: launchedLoaded, error: launchedError },
  ];

  return (
    <Screen padded={false}>
      <Header count={bothLoaded ? pool.count : null} lamports={pool.lamports} />
      <LaneTabs lane={lane} counts={counts} onPick={goTo} />
      <View style={{ flex: 1 }} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
        {pageW > 0 ? (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={onDrag}
            onMomentumScrollEnd={onSettle}
          >
            {pages.map((p, i) => (
              <Lane key={p.lane.id} width={pageW} current={i === lane} {...p} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Screen>
  );
}

const openPresale = (key) => router.push(`/presale/${key}`);
const openCoin = (key) => router.push(`/coin/${key}`);

/** Final Stretch's or Migrated's renderItem. */
const marketItem = (laneId, solUsd) =>
  function renderMarket({ item }) {
    return (
      <FadeOnce id={`${laneId}:${item.presale}`}>
        <MarketCard row={item} solUsd={solUsd} onPress={openCoin} />
      </FadeOnce>
    );
  };

const Gap = () => <View style={{ height: 10 }} />;

const LIST_PAD = { paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: S.gutter };
const keyOf = (r) => r.presale;

/** One lane's list, or a spinner until its feed (and, for New Pairs, the pool size) is in.
 *  A lane not shown is hidden from TalkBack, so it reads only the lane on screen. */
const Lane = memo(function Lane({ lane, data, renderItem, ready, error, width, current }) {
  const some = data.length > 0;
  const header = useMemo(
    () => (error && some ? <T v="small" color={C.down} style={{ marginBottom: 10 }}>{error}</T> : null),
    [error, some],
  );
  const empty = useMemo(
    () => <Empty title={lane.empty} body={error ? <T v="small" color={C.down}>{error}</T> : lane.body} />,
    [lane, error],
  );
  return (
    <View
      style={{ width }}
      importantForAccessibility={current ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!current}
    >
      {ready ? (
        <FlatList
          data={data}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={LIST_PAD}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
        </View>
      )}
    </View>
  );
});

/** The three lanes' names and counts; the one shown is underlined in the ER colour. A new
 *  count fades in; a null count (its feeds not in yet) isn't drawn. */
const LaneTabs = memo(function LaneTabs({ lane, counts, onPick }) {
  return (
    <View style={{ flexDirection: "row", marginHorizontal: S.gutter, borderBottomWidth: 1, borderColor: C.line }}>
      {LANES.map((l, i) => {
        const on = i === lane;
        const n = counts[l.id];
        return (
          <Pressable
            key={l.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n == null ? l.title : `${l.title}, ${n}`}
            onPress={() => onPick(i)}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
              paddingVertical: 10, marginBottom: -1, borderBottomWidth: 2, borderColor: on ? C.er : "transparent",
            }}
          >
            <T v="small" color={on ? C.text0 : C.text2} style={{ fontFamily: F.semi }}>{l.title}</T>
            {n == null ? null : (
              <Move kind="fade" key={n}>
                <T v="small" color={C.text2} style={{ fontFamily: F.mono, fontSize: 11 }}>{String(n)}</T>
              </Move>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});

/** "Pulse" over "X SOL filling N pools" (`count` null: the feeds aren't in yet, and the line
 *  is blank, keeping its height), and on the right the wallet's SOL, or a small "Connect"
 *  with no wallet. */
const Header = memo(function Header({ count, lamports: filled }) {
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
        {count == null ? (
          <T v="small" importantForAccessibility="no" accessibilityElementsHidden>{" "}</T>
        ) : (
          <T v="small" numberOfLines={1}>
            <T v="small" color={C.er} style={{ fontFamily: F.mono }}>{`${solText(filled)} SOL`}</T>
            {` filling ${count} pool${count === 1 ? "" : "s"}`}
          </T>
        )}
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
});
