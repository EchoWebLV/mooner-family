// Pulse: the room's picture with Ranks and Chat on it and the SOL filling the pools; then three
// lanes you swipe between (Filling, Live, Mooned), from the presales and launched feeds the
// server pushes. Quiet but for a tap when the lane changes; cards and lane counts only fade
// in, once.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { GRAD_SOL } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { unreadOf } from "../../src/chat/rooms";
import { MarketCard } from "../../src/launched/MarketCard";
import { EXPIRED_STAYS_MS, expiredSeen, filling, finalStretch, migrated, newPairs, settledLane } from "../../src/live/lanes";
import { PresaleCard } from "../../src/live/PresaleCard";
import { solText } from "../../src/ui/format";
import { Glass, SceneHeader } from "../../src/ui/Glass";
import { ChatIcon, TrophyIcon } from "../../src/ui/icons";
import { Empty, T } from "../../src/ui/kit";
import { FadeOnce, Move } from "../../src/ui/motion";
import { play } from "../../src/ui/sound";
import { C, F, S } from "../../src/ui/theme";

const LANES = [
  { id: "new", title: "Filling", empty: "No pools filling right now", body: "New ones show up here the moment they open." },
  { id: "final", title: "Live", empty: "Nothing live yet", body: "Coins land here the moment their pool fills." },
  { id: "migrated", title: "Mooned", empty: "Nothing mooned yet", body: `Coins move here when their curve reaches ${GRAD_SOL} SOL.` },
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

  // final and migrated read only the launched feed; each card gets its row (Filling: the
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
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <SceneHeader
        name="room"
        height={236}
        title="Pulse"
        right={[
          <Glass key="ranks" label="Ranks" onPress={openRanks}>
            <TrophyIcon color={C.text0} size={20} />
          </Glass>,
          <ChatGlass key="chat" />,
        ]}
      >
        <Stat count={bothLoaded ? pool.count : null} lamports={pool.lamports} />
      </SceneHeader>
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
    </View>
  );
}

const openPresale = (key) => router.push(`/presale/${key}`);
const openCoin = (key) => router.push(`/coin/${key}`);
const openRanks = () => router.push("/ranks");
const openChat = () => router.push("/chat");

/** Chat's glass button, with the dot while a global line came live since Everyone was last
 *  shown (store chatSeen). */
const ChatGlass = memo(function ChatGlass() {
  const unread = useStore(store, (s) => unreadOf(s.chats.global, s.chatSeen));
  return (
    <Glass label="Chat" onPress={openChat} dot={unread}>
      <ChatIcon color={C.text0} size={20} />
    </Glass>
  );
});

/** The SOL filling the pools, big and green, over "filling N pools right now", at the
 *  scene's bottom left. `count` null (the feeds aren't in yet): blank, keeping its height. */
const Stat = memo(function Stat({ count, lamports }) {
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: S.gutter, paddingBottom: 12 }}>
      {count == null ? (
        <View style={{ height: 52 }} />
      ) : (
        <View style={{ height: 52, justifyContent: "flex-end" }}>
          <T style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: -0.5, color: C.up }}>{`${solText(lamports)} SOL`}</T>
          <T v="small" numberOfLines={1}>{`filling ${count} pool${count === 1 ? "" : "s"} right now`}</T>
        </View>
      )}
    </View>
  );
});

/** Live's or Mooned's renderItem. */
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

/** One lane's list, or a spinner until its feed (and, for Filling, the pool size) is in.
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

/** The three lanes as one segmented control: the shown lane on a raised pill, its count in
 *  green. A new count fades in; a null count (its feeds not in yet) isn't drawn. */
const LaneTabs = memo(function LaneTabs({ lane, counts, onPick }) {
  return (
    <View
      style={{
        flexDirection: "row", marginHorizontal: S.gutter, marginTop: 12, padding: 3,
        backgroundColor: C.bg1, borderWidth: 1, borderColor: C.line, borderRadius: 12,
      }}
    >
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
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
              paddingVertical: 8, borderRadius: 9, backgroundColor: on ? C.bg3 : "transparent",
            }}
          >
            <T style={{ fontFamily: F.medium, fontSize: 14, color: on ? C.text0 : C.text2 }}>{l.title}</T>
            {n == null ? null : (
              <Move kind="fade" key={n}>
                <T style={{ fontFamily: F.mono, fontSize: 12, color: on ? C.up : C.text2, opacity: on ? 1 : 0.7 }}>{String(n)}</T>
              </Move>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});
