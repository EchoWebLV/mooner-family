// The presale room: the ring filling as SOL comes in, who's in, the coin, and your part at
// the bottom (connect, join, your seat). Chat slides up; the launch plays full screen.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { seatOf, whoIsIn } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { useSigner } from "../../src/wallet";
import { ChatSheet } from "../../src/room/ChatSheet";
import { JoinSheet } from "../../src/room/JoinSheet";
import { LaunchOverlay } from "../../src/room/LaunchOverlay";
import { YourSeat } from "../../src/room/YourSeat";
import { BackIcon, ChatIcon } from "../../src/room/icons";
import { bottomOf, heroOf, isKey, linksOf } from "../../src/room/room";
import { CoinImage } from "../../src/ui/CoinImage";
import { Face } from "../../src/ui/Face";
import { shortWallet, solText } from "../../src/ui/format";
import { Button, Card, Empty, Pill, Screen, Sheet, T } from "../../src/ui/kit";
import { Ring } from "../../src/ui/Ring";
import { useNow } from "../../src/ui/useNow";
import { C, F, R, S } from "../../src/ui/theme";

const FACES = 8;
/** How long "X SOL is back in your wallet" stays. */
const BACK_NOTE_MS = 4_000;

const tap = () => Haptics.selectionAsync().catch(() => {});

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
}

export default function Room() {
  const params = useLocalSearchParams();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  const valid = isKey(key);

  useEffect(() => (valid ? store.getState().watch(key) : undefined), [key, valid]);

  const view = useStore(store, (s) => s.views[key] ?? s.presales[key]);
  const detail = useStore(store, (s) => s.views[key]);
  const missing = useStore(store, (s) => !!s.missing[key]);
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const launched = useStore(store, (s) => s.launched[key]);
  const chatCount = useStore(store, (s) => s.chats[key]?.length ?? 0);
  const now = useNow(1000);
  const signer = useSigner();
  const insets = useSafeAreaInsets();

  // A detail view kept from an earlier visit isn't this visit's: the launch moment waits for
  // the first snapshot since the room opened.
  const kept = useMemo(() => store.getState().views[key], [key]);
  const ready = !!detail && detail !== kept;

  const [joinOpen, setJoinOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [face, setFace] = useState(null); // a whoIsIn row
  const [backNote, setBackNote] = useState(null);
  const closeJoin = useCallback(() => setJoinOpen(false), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const onBack = useCallback((deposit) => setBackNote(`${solText(deposit)} SOL is back in your wallet`), []);

  useEffect(() => {
    if (!backNote) return;
    const t = setTimeout(() => setBackNote(null), BACK_NOTE_MS);
    return () => clearTimeout(t);
  }, [backNote]);

  const who = useMemo(() => (view ? whoIsIn(view) : []), [view]);
  const seat = useMemo(() => (view && wallet ? seatOf(view, wallet) : null), [view, wallet]);
  const ticker = view?.token?.symbol;

  if (!valid || missing) {
    return (
      <Screen padded={false}>
        <TopBar title="" />
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: S.gutter }}>
          <Empty title="This presale isn't here" body="It may have closed." />
          <Button kind="quiet" title="Back" onPress={goBack} />
        </View>
      </Screen>
    );
  }

  if (!view || !info) {
    return (
      <Screen padded={false}>
        <TopBar title="" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {infoError ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{infoError}</T> : null}
        </View>
      </Screen>
    );
  }

  const hero = heroOf(view, launched, info.N, now);
  const bottom = bottomOf(view, wallet, info.N, now);

  return (
    <Screen padded={false}>
      <TopBar title={ticker ? `$${ticker}` : "Presale"} chats={chatCount} onChat={() => setChatOpen(true)} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.gutter, paddingBottom: 24, gap: 24 }}>
        <View style={{ alignItems: "center", gap: 12, paddingTop: 8 }}>
          <Ring size={260} fill={hero.fill} color={hero.color}>
            <T v="bigNum">{solText(view.raised)}</T>
            <T v="small">{`of ${solText(info.N.TARGET)} SOL`}</T>
          </Ring>
          {hero.stage === "presale" ? (
            <T v="num">{hero.under}</T>
          ) : (
            <T v="body" color={hero.color === C.text2 ? C.text1 : hero.color} style={{ fontFamily: F.medium }}>{hero.under}</T>
          )}
        </View>
        <WhoIsIn rows={who} onFace={setFace} />
        {view.token ? <Coin token={view.token} /> : null}
      </ScrollView>
      <View
        style={{
          borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg0, paddingHorizontal: S.gutter,
          paddingTop: 12, paddingBottom: insets.bottom + 12, gap: 10,
        }}
      >
        {backNote ? <T v="small" color={C.up} style={{ textAlign: "center" }}>{backNote}</T> : null}
        {bottom.kind === "connect" ? <Button title="Connect to join" onPress={() => router.push("/connect")} /> : null}
        {bottom.kind === "seat" ? (
          <YourSeat view={view} launched={launched} seat={bottom.seat} wallet={wallet} now={now} signer={signer} onBack={onBack} />
        ) : null}
        {bottom.kind === "join" ? <Button title="Join" onPress={() => setJoinOpen(true)} /> : null}
        {bottom.kind === "why" ? <T v="small" color={C.text2} style={{ textAlign: "center" }}>{bottom.why}</T> : null}
      </View>

      <JoinSheet
        open={joinOpen}
        onClose={closeJoin}
        view={view}
        info={info}
        lamports={lamports}
        signer={signer}
        why={bottom.kind === "why" ? bottom.why : null}
      />
      <ChatSheet open={chatOpen} onClose={closeChat} channel={key} wallet={wallet} signer={signer} />
      <FaceSheet row={face} onClose={() => setFace(null)} />
      <LaunchOverlay view={view} launched={launched} seat={seat} ready={ready} />
    </Screen>
  );
}

/** Back on the left, the title centred, and the chat with its message count on the right. */
function TopBar({ title, chats, onChat }) {
  return (
    <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={() => {
          tap();
          goBack();
        }}
        style={({ pressed }) => [{ width: 56, height: 44, justifyContent: "center", paddingLeft: 4 }, pressed && { opacity: 0.6 }]}
      >
        <BackIcon color={C.text0} />
      </Pressable>
      <T v="h2" numberOfLines={1} style={{ flex: 1, textAlign: "center" }}>{title}</T>
      {onChat ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chats ? `Chat, ${chats} messages` : "Chat"}
          hitSlop={8}
          onPress={() => {
            tap();
            onChat();
          }}
          style={({ pressed }) => [
            { width: 56, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingRight: 8 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <ChatIcon color={C.text0} />
          {chats > 0 ? <T v="num" style={{ fontSize: 13 }} color={C.text1}>{chats}</T> : null}
        </Pressable>
      ) : (
        <View style={{ width: 56 }} />
      )}
    </View>
  );
}

/** "Who's in" and their faces, biggest commit first; a tap opens that person's card. */
function WhoIsIn({ rows, onFace }) {
  const shown = rows.slice(0, FACES);
  const more = rows.length - shown.length;
  const size = 36;
  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <T v="label">Who's in</T>
      {rows.length ? (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {shown.map((r, i) => (
            <Pressable
              key={r.user}
              accessibilityRole="button"
              accessibilityLabel={shortWallet(r.user)}
              onPress={() => {
                tap();
                onFace(r);
              }}
              style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}
            >
              <Face wallet={r.user} size={size} ring={C.bg0} />
            </Pressable>
          ))}
          {more > 0 ? (
            <View
              style={{
                marginLeft: -size * 0.3, width: size, height: size, borderRadius: R.pill, backgroundColor: C.bg3,
                borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
              }}
            >
              <T v="num" style={{ fontSize: 12 }} color={C.text1}>{`+${more}`}</T>
            </View>
          ) : null}
        </View>
      ) : (
        <T v="small" color={C.text2}>Nobody yet</T>
      )}
    </View>
  );
}

/** One person in the pool: their face, wallet, what they put in, and whether they made it. */
function FaceSheet({ row, onClose }) {
  return (
    <Sheet open={!!row} onClose={onClose}>
      {row ? (
        <View style={{ alignItems: "center", gap: 10, paddingBottom: 8 }}>
          <Face wallet={row.user} size={64} />
          <T v="num">{shortWallet(row.user)}</T>
          <T v="h2">{`${solText(row.commit)} SOL`}</T>
          {row.creator ? <Pill text="Creator" color={C.gold} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/** The coin: picture, name, ticker, what it's about (3 lines, "More" shows the rest), links. */
function Coin({ token }) {
  const links = linksOf(token);
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CoinImage uri={token.image} size={56} ticker={token.symbol} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="h2" numberOfLines={1}>{token.name}</T>
          <T v="small" numberOfLines={1}>{`$${token.symbol}`}</T>
        </View>
      </View>
      {token.description ? <About text={token.description} /> : null}
      {links.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {links.map((l) => (
            <Pressable
              key={l.label}
              accessibilityRole="link"
              accessibilityLabel={l.label}
              hitSlop={6}
              onPress={() => {
                tap();
                Linking.openURL(l.url).catch(() => {});
              }}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Pill text={l.label} color={C.text0} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Three lines, and "More" when there are more. A hidden copy with no line limit counts them. */
function About({ text }) {
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <T v="small" numberOfLines={open ? undefined : 3}>{text}</T>
      <T
        v="small"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        onTextLayout={(e) => setLong(e.nativeEvent.lines.length > 3)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: 0 }}
      >
        {text}
      </T>
      {long && !open ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen(true)} style={{ alignSelf: "flex-start", paddingTop: 4 }}>
          <T v="small" color={C.accent} style={{ fontFamily: F.medium }}>More</T>
        </Pressable>
      ) : null}
    </View>
  );
}
