// Ranks: the server's XP rows as boards (Overall, then one per title). The top three stand on
// the live picture; the rest are rows under the board chips; yours is pinned at the bottom.
// Before the pictures' first snapshot, a spinner; after it, with no XP rows, "No ranks yet"
// (a server without XP never sends any).
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { LEVEL_XP, POINTS } from "../../engine/src/xp.js";
import { store } from "../src/app";
import { ChipRow } from "../src/ui/ChipRow";
import { Face } from "../src/ui/Face";
import { shortWallet } from "../src/ui/format";
import { BackGlass, Glass, SceneHeader } from "../src/ui/Glass";
import { CrownIcon, InfoIcon } from "../src/ui/icons";
import { Empty, Sheet, T } from "../src/ui/kit";
import { Move } from "../src/ui/motion";
import { TitleTag } from "../src/ui/TitleTag";
import { C, F, R, S } from "../src/ui/theme";
import { PODIUM, TITLE_COLORS } from "../src/xp/look";
import { BOARDS, GENESIS_XP, TITLE_NAMES, boardOf, xpNum, xpText } from "../src/xp/rows";

const CHIPS = BOARDS.map((b) => ({ key: b.key, label: b.name }));

export default function Ranks() {
  const xp = useStore(store, (s) => s.xp);
  const xpLoaded = useStore(store, (s) => s.xpLoaded);
  const profilesLoaded = useStore(store, (s) => s.profilesLoaded);
  const wallet = useStore(store, (s) => s.wallet);
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState("overall");
  const [info, setInfo] = useState(false);
  const rows = useMemo(() => boardOf(xp, board, wallet), [xp, board, wallet]);
  const ready = profilesLoaded && xpLoaded && Object.keys(xp).length > 0;
  const top = rows.slice(0, 3);
  const rest = useMemo(() => rows.slice(3), [rows]);
  const mine = rows.find((r) => r.mine) ?? null;

  let list;
  if (!profilesLoaded) {
    list = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.text1} />
      </View>
    );
  } else if (!ready || rows.length === 0) {
    list = <Empty title="No ranks yet" body="XP comes from launches: open one, chip in, bring friends, hold." />;
  } else {
    list = (
      <FlatList
        data={rest}
        keyExtractor={(r) => r.wallet}
        renderItem={({ item }) => <RankRow row={item} />}
        // with no wallet there's no pinned row to keep the last rows above the system bar
        contentContainerStyle={{ paddingBottom: 16 + (wallet ? 0 : insets.bottom) }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <SceneHeader
        name="live"
        height={300}
        motion="lift"
        title="Ranks"
        left={<BackGlass />}
        right={
          <Glass label="How XP works" onPress={() => setInfo(true)}>
            <InfoIcon color={C.text0} size={20} />
          </Glass>
        }
      >
        {ready && top.length ? <Podium top={top} /> : null}
      </SceneHeader>
      {ready ? <ChipRow items={CHIPS} value={board} onPick={setBoard} /> : null}
      <View style={{ flex: 1 }}>{list}</View>
      {wallet && ready ? <MyRow wallet={wallet} row={mine} /> : null}
      <HowSheet open={info} onClose={() => setInfo(false)} />
    </View>
  );
}

/** The top three over the picture's bottom: #2 left, #1 raised in the middle, #3 right. It
 *  rises in once. */
function Podium({ top }) {
  const [first, second, third] = top;
  return (
    <Move kind="rise" style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 14, paddingBottom: 6 }}>
      <Spot row={second} place={2} />
      <Spot row={first} place={1} />
      <Spot row={third} place={3} />
    </Move>
  );
}

/** One podium place: the face in its ring (with a crown and a glow for #1), the place on a
 *  badge, the name and the XP. An empty place keeps its width. */
function Spot({ row, place }) {
  if (!row) return <View style={{ width: 96 }} />;
  const size = place === 1 ? 76 : 58;
  const ring = PODIUM[place];
  return (
    <View style={{ width: 96, alignItems: "center", marginBottom: place === 1 ? 14 : 0 }}>
      {place === 1 ? <CrownIcon color={C.gold} size={22} /> : null}
      <View style={{ width: size, height: size, marginTop: place === 1 ? 2 : 0 }}>
        {place === 1 ? (
          <View style={{ position: "absolute", top: -8, left: -8, right: -8, bottom: -8, borderRadius: (size + 16) / 2, backgroundColor: C.goldSoft }} />
        ) : null}
        <Face wallet={row.wallet} size={size} ring={ring} />
        <View
          style={{
            position: "absolute", bottom: -8, left: (size - 22) / 2, width: 22, height: 22, borderRadius: 11,
            backgroundColor: ring, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.bg0,
          }}
        >
          <T style={{ fontFamily: F.bold, fontSize: 11, color: C.bg0 }}>{String(place)}</T>
        </View>
      </View>
      <T numberOfLines={1} style={{ marginTop: 12, fontFamily: F.semi, fontSize: 13 }}>{row.mine ? "you" : shortWallet(row.wallet)}</T>
      <T style={{ fontFamily: F.mono, fontSize: 12, color: C.up }}>{xpText(row.xp)}</T>
    </View>
  );
}

/** A row from #4 down: rank, face, name, title tag, XP. */
function RankRow({ row }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: S.gutter }}>
      <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text2, minWidth: 30 }}>{`#${row.rank}`}</T>
      <Face wallet={row.wallet} size={34} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 15, flexShrink: 1 }}>{row.mine ? "you" : shortWallet(row.wallet)}</T>
        <TitleTag title={row.title} level={row.level} />
      </View>
      <T style={{ fontFamily: F.mono, fontSize: 14 }}>{xpNum(row.xp)}</T>
    </View>
  );
}

/** Your place on this board, pinned with the accent rim; off the board, how to get on it. */
function MyRow({ wallet, row }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: S.gutter, paddingTop: 8, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg0 }}>
      <View
        style={{
          flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 12,
          borderRadius: R.l, borderWidth: 1, borderColor: C.accent, backgroundColor: C.accentSoft,
        }}
      >
        {row ? <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text0, minWidth: 30 }}>{`#${row.rank}`}</T> : null}
        <Face wallet={wallet} size={34} />
        {row ? (
          <>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T style={{ fontFamily: F.semi, fontSize: 15 }}>you</T>
              <TitleTag title={row.title} level={row.level} />
            </View>
            <T style={{ fontFamily: F.mono, fontSize: 14 }}>{xpNum(row.xp)}</T>
          </>
        ) : (
          <T v="small" color={C.text1} style={{ flex: 1 }}>Not ranked yet: chip in to a launch</T>
        )}
      </View>
    </View>
  );
}

/** What earns XP, read from the shared points table. */
const EARN = [
  { title: "dev", text: `Open a launch: +${xpText(POINTS.devLaunch.points)} when it launches, +${xpText(POINTS.devMigrate.points)} more when it moons` },
  { title: "kol", text: `Chip in to someone else's launch: +${xpText(POINTS.kolLaunch.points)}, +${xpText(POINTS.kolMigrate.points)} more when it moons` },
  { title: "raider", text: `+${xpText(POINTS.raiderJoin.points)} for each friend your link brings who chips in, once it launches` },
  { title: "diamond", text: `Still holding when it moons: +${xpText(POINTS.diamondMigrate.points)}` },
];

function HowSheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="How XP works">
      <View style={{ gap: 14 }}>
        {EARN.map((e) => (
          <View key={e.title} style={{ gap: 4 }}>
            <T style={{ fontFamily: F.semi, fontSize: 15, color: TITLE_COLORS[e.title] }}>{TITLE_NAMES[e.title]}</T>
            <T v="small">{e.text}</T>
          </View>
        ))}
        <View style={{ gap: 4 }}>
          <T style={{ fontFamily: F.semi, fontSize: 15, color: C.gold }}>Seeker Genesis</T>
          <T v="small">{`+${xpText(GENESIS_XP)} once, for a Seeker Genesis Token in your wallet`}</T>
        </View>
        <T v="small" color={C.text2}>{`Levels I to V start at ${LEVEL_XP.map(xpNum).join(", ")} XP.`}</T>
      </View>
    </Sheet>
  );
}
