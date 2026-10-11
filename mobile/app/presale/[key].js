// The presale room: its scene with the coin, time left and the last chat lines; the pool as
// cells; who's in; your seat; the coin. The host, your button and the chat sit at the bottom.
// The chat slides up; the launch plays full screen.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { chatGate } from "../../../engine/src/cues.js";
import { seatOf, stageOf, whoIsIn } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { useAccount, useSigner } from "../../src/wallet";
import { stillIn } from "../../src/launched/coin";
import { ChatLines } from "../../src/room/ChatLines";
import { ChatSheet } from "../../src/room/ChatSheet";
import { Crowd } from "../../src/room/Crowd";
import { FloatingEmojis } from "../../src/room/FloatingEmojis";
import { JoinSheet } from "../../src/room/JoinSheet";
import { LaunchMoment, useMoment } from "../../src/room/LaunchMoment";
import { GetBack, Line, SeatCard } from "../../src/room/YourSeat";
import { useNewLines } from "../../src/room/useNewLines";
import { bottomOf, claimedOf, heroOf, isKey, joinedSince, lockedCommit, poolLine, refToNote, walletsIn, whoKnown } from "../../src/room/room";
import { shareOf } from "../../src/room/share";
import { LINKS } from "../../src/config";
import { Cells } from "../../src/ui/Cells";
import { CoinImage } from "../../src/ui/CoinImage";
import { Face } from "../../src/ui/Face";
import { shortWallet, solText } from "../../src/ui/format";
import { BackIcon, ChatIcon, CheckIcon, ShareIcon } from "../../src/ui/icons";
import { Host } from "../../src/ui/Host";
import { Button, Card, Empty, Pill, Screen, Sheet, Steps, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { Move } from "../../src/ui/motion";
import { Scene } from "../../src/ui/Scene";
import { isArmed, play } from "../../src/ui/sound";
import { TopBar, goBack } from "../../src/ui/TopBar";
import { useAppActive } from "../../src/ui/useAppActive";
import { useNow } from "../../src/ui/useNow";
import { C, F, R, S } from "../../src/ui/theme";

/** How long "X SOL is back in your wallet" stays. */
const BACK_NOTE_MS = 4_000;
/** Where back goes when the room was opened from a link. */
const HOME = "/(tabs)";
/** The scene's height; the top row, the chat strip and the pool sit over it. */
const SCENE_H = 300;
/** bg0 at 60%: the round buttons over the scene. */
const SCENE_BUTTON = `${C.bg0}99`;
const WITH_SEAT = "Share your link. It launches the moment the pool is full.";
const WITHOUT_SEAT = "Take a seat. It launches the moment the pool is full.";
/** The top row's ticker keeps at least this width when the time or status beside it is long. */
const TITLE_MIN = 72;
/** One row of the crowd (a face and its SOL): the space it holds until who's in is known. */
const CROWD_ROW = 62;

const tap = () => Haptics.selectionAsync().catch(() => {});

export default function Room() {
  const params = useLocalSearchParams();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  const valid = isKey(key);

  useEffect(() => (valid ? store.getState().watch(key) : undefined), [key, valid]);

  const ref = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  // A link someone shared (`?ref=<their wallet>`): kept until a join from this phone lands here.
  // Noted once the saved wallet is read (refToNote). When it was there, FollowWallet's effect
  // has set store.wallet first: it runs before this one in the same commit (it's an earlier
  // sibling of the screens) and setWallet sets `wallet` before its first await.
  const account = useAccount();
  const toNote = refToNote(valid, ref, account);
  useEffect(() => {
    if (toNote) store.getState().noteRef(key, toNote);
  }, [key, toNote]);

  const view = useStore(store, (s) => s.views[key] ?? s.presales[key]);
  const detail = useStore(store, (s) => s.views[key]);
  const missing = useStore(store, (s) => !!s.missing[key]);
  const viewError = useStore(store, (s) => s.viewError[key] ?? null);
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const launched = useStore(store, (s) => s.launched[key]);
  const chatCount = useStore(store, (s) => s.chats[key]?.length ?? 0);
  const busy = useStore(store, (s) => s.busy);
  const mineEntry = useStore(store, (s) => s.mine[key]);
  const focused = useIsFocused();
  // focus stays with the phone locked or another app up: sounds and the moment wait for both
  const active = useAppActive();
  const heard = focused && active;
  const now = useNow(1000, focused);
  const signer = useSigner();
  const insets = useSafeAreaInsets();

  // A detail view kept from an earlier visit isn't this visit's: the launch moment waits for
  // the first snapshot since the room opened.
  const [kept] = useState(() => store.getState().views[key]);
  const ready = !!detail && detail !== kept;

  const [joinOpen, setJoinOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [face, setFace] = useState(null); // a whoIsIn row
  const [backNote, setBackNote] = useState(null);
  const openJoin = useCallback(() => setJoinOpen(true), []);
  const closeJoin = useCallback(() => setJoinOpen(false), []);
  const openChat = useCallback(() => setChatOpen(true), []);
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
  const stage = view ? stageOf(view, launched) : null;

  // `join` when a wallet takes a seat, from this visit's first snapshot on, while the presale
  // takes seats: the seat that fills the pool brings POOL FULL and its own sounds
  const before = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const joined = joinedSince(before.current, who);
    before.current = new Set(who.map((w) => w.user));
    if (joined.length && heard && stage === "presale") play("join");
  }, [ready, who, heard, stage]);

  // Whether this wallet's tokens arrived: its seat's commit last seen after OPEN (kept here,
  // per presale and wallet), else a join from this phone not taken back (the keeper delivers
  // the tokens by itself, so the room may never see the seat after OPEN).
  const [lock, setLock] = useState({ key: null, wallet: null, commit: null });
  const same = lock.key === key && lock.wallet === wallet;
  const locked = lockedCommit(detail, wallet, same ? lock.commit : null);
  if (!same || lock.commit !== locked) setLock({ key, wallet, commit: locked });
  const claimed = claimedOf(detail, wallet, locked ?? (stillIn(mineEntry) ? 1n : null));
  const moment = useMoment({ view, detail, launched, ready, claimed });
  const momentOn = moment.phase != null && moment.phase !== "done";

  // `chat` when a line arrives, at most one every 400 ms, where the chat shows: the room, or
  // the launching screen over it (POOL FULL keeps to its own sounds; failed is quiet)
  const [chatSound] = useState(() => chatGate());
  const chatHeard = heard && (moment.screen == null || moment.screen === "launching");
  const onLine = useCallback(() => {
    if (chatHeard && chatSound(Date.now())) play("chat");
  }, [chatHeard, chatSound]);
  useNewLines(key, onLine);

  if (!valid || missing) {
    return (
      <Screen padded={false}>
        <TopBar title="" fallback={HOME} />
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: S.gutter }}>
          <Empty title="This presale isn't here" body="It may have closed." />
          <Button kind="quiet" title="Back" onPress={() => goBack(HOME)} />
        </View>
      </Screen>
    );
  }

  if (!view || !info) {
    const error = infoError || viewError;
    return (
      <Screen padded={false}>
        <TopBar title="" fallback={HOME} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
        </View>
      </Screen>
    );
  }

  const hero = heroOf(view, launched, info.N, now);
  const bottom = bottomOf(view, wallet, info.N, now, claimed);
  // A join going on with its sheet closed (by a tap outside it, or back): its steps show here.
  const joinBusy = busy?.kind === "join" && busy.key === key && !joinOpen && bottom.kind !== "seat";
  // null while the presale is OPEN past its deadline: no Share or Invite then (src/room/share.js)
  const shareText = shareOf({ view, launched, wallet, N: info.N, base: LINKS, now });
  const onShare = () => {
    if (shareText) Share.share(shareText, { dialogTitle: "Share this presale" }).catch(() => {});
  };
  // Invite (and the host's line about it) only while the presale takes seats; the round Share
  // button at the top covers the other stages
  const invite = hero.stage === "presale" && bottom.kind === "seat" && !!shareText;
  const hostLine =
    hero.stage !== "presale" ? null
    : bottom.kind === "seat" ? (shareText ? WITH_SEAT : null)
    : bottom.kind === "join" || bottom.kind === "connect" ? WITHOUT_SEAT
    : null;
  const main =
    bottom.kind === "connect" ? <Button title="Connect to join" onPress={() => router.push("/connect")} />
    : bottom.kind === "seat" ? (invite ? <Button title="Invite" onPress={onShare} /> : null)
    : bottom.kind === "claimed" ? <Button title={ticker ? `See $${ticker}` : "See the coin"} onPress={() => router.push(`/coin/${key}`)} />
    : joinBusy ? <Button title="Join" onPress={openJoin} busy />
    : bottom.kind === "join" ? <Button title="Join" onPress={openJoin} />
    : null;
  const timeColor = hero.stage === "presale" ? C.text0 : hero.color === C.text2 ? C.text1 : hero.color;
  // a list item without its users says nothing about who's in: no count and no "Nobody yet"
  const known = whoKnown(view);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <Scene name="room" height={SCENE_H} style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: S.gutter, paddingTop: 6 }}>
          <SceneButton label="Back" onPress={() => goBack(HOME)}>
            <BackIcon color={C.text0} />
          </SceneButton>
          {view.token ? <CoinImage uri={view.token.image} size={42} ticker={view.token.symbol} /> : null}
          <View style={{ flex: 1, minWidth: TITLE_MIN }}>
            <T v="h2" numberOfLines={1}>{ticker ? `$${ticker}` : "Presale"}</T>
            {view.token?.name ? <T v="small" color={C.text0} numberOfLines={1}>{`Presale · ${view.token.name}`}</T> : null}
          </View>
          <T v="num" color={timeColor} numberOfLines={1} style={{ fontSize: 16, flexShrink: 1 }}>{hero.under}</T>
          {shareText && !invite ? (
            <SceneButton label="Share" onPress={onShare}>
              <ShareIcon color={C.text0} size={20} />
            </SceneButton>
          ) : null}
        </View>
        <View style={{ height: 100, justifyContent: "flex-end", paddingHorizontal: S.gutter, paddingBottom: 6 }}>
          <ChatLines channel={key} onPress={openChat} />
        </View>
        <View style={{ paddingHorizontal: S.gutter, gap: 12 }}>
          <Move kind="rise">
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <T v="label">Pool</T>
                <T v="num" color={C.text2} style={{ fontSize: 13 }}>
                  <T v="num" color={hero.color} style={{ fontSize: 13 }}>{solText(view.raised)}</T>
                  {` / ${solText(info.N.TARGET)} SOL`}
                </T>
              </View>
              <Cells raised={view.raised} target={info.N.TARGET} color={hero.stage === "expired" ? C.text2 : C.er} />
              {detail ? <T v="small">{poolLine(detail, info.N)}</T> : null}
            </View>
          </Move>
          <Move kind="rise" delay={90}>
            <Card style={{ gap: 12, paddingHorizontal: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 }}>
                <T v="label">Who's in</T>
                {known ? (
                  <T v="num" color={C.text2} accessibilityLabel={walletsIn(who.length)} style={{ fontSize: 12 }}>{who.length}</T>
                ) : null}
              </View>
              {known ? <Crowd who={who} me={wallet} onFace={setFace} ready={ready} /> : <View style={{ height: CROWD_ROW }} />}
            </Card>
          </Move>
          {bottom.kind === "seat" ? (
            <Move kind="rise" delay={180}>
              <SeatCard view={view} launched={launched} seat={bottom.seat} wallet={wallet} now={now} />
            </Move>
          ) : null}
          {view.token ? (
            <Move kind="rise" delay={270}>
              <Coin token={view.token} />
            </Move>
          ) : null}
        </View>
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: SCENE_H - 40 }}>
          <FloatingEmojis channel={key} on={heard && !chatOpen && !joinOpen && !face && !momentOn} />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: S.gutter, paddingTop: 10, paddingBottom: insets.bottom + 10, gap: 10, backgroundColor: C.bg0 }}>
        {hostLine ? <Host line={hostLine} sound={heard && isArmed()} /> : null}
        {backNote ? (
          <T v="small" color={C.up} accessibilityLiveRegion="polite" style={{ textAlign: "center" }}>{backNote}</T>
        ) : null}
        {bottom.kind === "claimed" ? (
          <Line icon={<CheckIcon color={C.gold} />} color={C.gold}>Your tokens arrived</Line>
        ) : null}
        {joinBusy ? <Steps step={busy.step} /> : null}
        {bottom.kind === "why" && !joinBusy ? <T v="small" color={C.text2} style={{ textAlign: "center" }}>{bottom.why}</T> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>{main}</View>
          <ChatButton count={chatCount} onPress={openChat} />
        </View>
        {bottom.kind === "seat" ? (
          <GetBack view={view} launched={launched} seat={bottom.seat} wallet={wallet} now={now} signer={signer} onBack={onBack} />
        ) : null}
      </View>

      <JoinSheet
        open={joinOpen}
        onClose={closeJoin}
        onFailed={openJoin}
        view={view}
        info={info}
        lamports={lamports}
        signer={signer}
        why={bottom.kind === "why" ? bottom.why : bottom.kind === "seat" ? "You're already in." : null}
      />
      <ChatSheet open={chatOpen} onClose={closeChat} channel={key} wallet={wallet} signer={signer} />
      <FaceSheet row={face} onClose={() => setFace(null)} />
      <LaunchMoment
        moment={moment}
        view={view}
        launched={launched}
        who={who}
        seat={seat}
        commit={locked}
        claimed={claimed}
        focused={heard}
        wallet={wallet}
        N={info.N}
        onShare={shareText ? onShare : null}
      />
    </Screen>
  );
}

/** A round button over the scene, on a dark veil. */
function SceneButton({ label, onPress, children }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        { width: 40, height: 40, borderRadius: 20, backgroundColor: SCENE_BUTTON, alignItems: "center", justifyContent: "center" },
        pressed && { opacity: 0.6 },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** The chat, with its message count, next to the main button. */
function ChatButton({ count, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Chat, ${count} messages` : "Chat"}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          minWidth: 52, height: 52, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, borderColor: C.lineStrong,
          backgroundColor: C.bg2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <ChatIcon color={C.text0} />
      {count > 0 ? <T v="num" color={C.text1} style={{ fontSize: 13 }}>{count}</T> : null}
    </Pressable>
  );
}

/** One person in the pool: their face, wallet, what they put in, and whether they made it.
 *  It keeps the last person while it slides out, so it doesn't go blank on the way down. */
function FaceSheet({ row, onClose }) {
  const last = useRef(row);
  if (row) last.current = row;
  const shown = last.current;
  return (
    <Sheet open={!!row} onClose={onClose}>
      {shown ? (
        <View style={{ alignItems: "center", gap: 10, paddingBottom: 8 }}>
          <Face wallet={shown.user} size={64} />
          <T v="num">{shortWallet(shown.user)}</T>
          <T v="h2">{`${solText(shown.commit)} SOL`}</T>
          {shown.creator ? <Pill text="Creator" color={C.gold} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/** The coin: picture, name, ticker, what it's about (3 lines, "More" shows the rest), links. */
const Coin = memo(function Coin({ token }) {
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
      <LinkPills token={token} />
    </Card>
  );
});

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
