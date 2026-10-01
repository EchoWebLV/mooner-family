// The presale room: the ring filling as SOL comes in, who's in, the coin, and your part at
// the bottom (connect, join, your seat). Chat slides up; the launch plays full screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { seatOf, whoIsIn } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { useAccount, useSigner } from "../../src/wallet";
import { stillIn } from "../../src/launched/coin";
import { ChatSheet } from "../../src/room/ChatSheet";
import { JoinSheet } from "../../src/room/JoinSheet";
import { LaunchOverlay } from "../../src/room/LaunchOverlay";
import { Line, YourSeat } from "../../src/room/YourSeat";
import { bottomOf, claimedOf, heroOf, isKey, lockedCommit, refToNote } from "../../src/room/room";
import { shareOf } from "../../src/room/share";
import { BASE } from "../../src/config";
import { CoinImage } from "../../src/ui/CoinImage";
import { Face, Faces } from "../../src/ui/Face";
import { shortWallet, solText } from "../../src/ui/format";
import { ChatIcon, CheckIcon, ShareIcon } from "../../src/ui/icons";
import { Button, Card, Empty, Pill, Screen, Sheet, Steps, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { Ring } from "../../src/ui/Ring";
import { TopBar, goBack } from "../../src/ui/TopBar";
import { useNow } from "../../src/ui/useNow";
import { C, F, S } from "../../src/ui/theme";

const FACES = 8;
/** How long "X SOL is back in your wallet" stays. */
const BACK_NOTE_MS = 4_000;
/** Where back goes when the room was opened from a link. */
const HOME = "/(tabs)";

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

  // Whether this wallet's tokens arrived: its seat's commit last seen after OPEN (kept here,
  // per presale and wallet), else a join from this phone not taken back (the keeper delivers
  // the tokens by itself, so the room may never see the seat after OPEN).
  const [lock, setLock] = useState({ key: null, wallet: null, commit: null });
  const same = lock.key === key && lock.wallet === wallet;
  const locked = lockedCommit(detail, wallet, same ? lock.commit : null);
  if (!same || lock.commit !== locked) setLock({ key, wallet, commit: locked });
  const claimed = claimedOf(detail, wallet, locked ?? (stillIn(mineEntry) ? 1n : null));

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
  // null while the presale is OPEN past its deadline: no Share button then (src/room/share.js)
  const shareText = shareOf({ view, launched, wallet, N: info.N, base: BASE, now });
  const onShare = () => {
    if (shareText) Share.share(shareText, { dialogTitle: "Share this presale" }).catch(() => {});
  };

  return (
    <Screen padded={false}>
      <TopBar
        title={ticker ? `$${ticker}` : "Presale"}
        fallback={HOME}
        side={100}
        right={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {shareText ? <ShareButton onPress={onShare} /> : null}
            <ChatButton count={chatCount} onPress={() => setChatOpen(true)} />
          </View>
        }
      />
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
        {bottom.kind === "claimed" ? (
          <>
            <Line icon={<CheckIcon color={C.gold} />} color={C.gold}>Your tokens arrived</Line>
            <Button title={ticker ? `See $${ticker}` : "See the coin"} onPress={() => router.push(`/coin/${key}`)} />
          </>
        ) : null}
        {joinBusy ? (
          <>
            <Steps step={busy.step} />
            <Button title="Join" onPress={openJoin} busy />
          </>
        ) : null}
        {bottom.kind === "join" && !joinBusy ? <Button title="Join" onPress={openJoin} /> : null}
        {bottom.kind === "why" && !joinBusy ? <T v="small" color={C.text2} style={{ textAlign: "center" }}>{bottom.why}</T> : null}
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
      <LaunchOverlay view={view} launched={launched} seat={seat} claimed={claimed} ready={ready} focused={focused} />
    </Screen>
  );
}

/** Opens Android's share sheet with the presale's link (src/room/share.js). */
function ShareButton({ onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.6 }]}
    >
      <ShareIcon color={C.text0} />
    </Pressable>
  );
}

/** The chat, with its message count, for the top bar's right side. */
function ChatButton({ count, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Chat, ${count} messages` : "Chat"}
      hitSlop={8}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        { width: 56, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingRight: 8 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <ChatIcon color={C.text0} />
      {count > 0 ? <T v="num" style={{ fontSize: 13 }} color={C.text1}>{count}</T> : null}
    </Pressable>
  );
}

/** "Who's in" and their faces, biggest commit first; a tap opens that person's card. */
function WhoIsIn({ rows, onFace }) {
  const wallets = useMemo(() => rows.map((r) => r.user), [rows]);
  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <T v="label">Who's in</T>
      {rows.length ? (
        <Faces wallets={wallets} size={36} max={FACES} ring={C.bg0} onPress={(w) => onFace(rows.find((r) => r.user === w))} />
      ) : (
        <T v="small" color={C.text2}>Nobody yet</T>
      )}
    </View>
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
function Coin({ token }) {
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
