// Live: the live scene lifts into place, LIVE ON METEORA pops, the ticker stamps, and your
// tokens' card rises with the amount from the chain (set, not counted up). The crowd that
// launched it. Trade opens the coin page once the snipe tax is over; Share the win shares it.
// Shown again (the room back in front), it opens settled and quiet.
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { store } from "../app";
import { positionOf } from "../launched/coin";
import { lockEnds, secondsTo } from "../launched/trade";
import { CoinImage } from "../ui/CoinImage";
import { Face } from "../ui/Face";
import { solText } from "../ui/format";
import { CheckIcon } from "../ui/icons";
import { Button, Card, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { Scene } from "../ui/Scene";
import { isArmed, nextScreen, play } from "../ui/sound";
import { useNow } from "../ui/useNow";
import { C, F, R, S } from "../ui/theme";
import { Crowd } from "./Crowd";
import { FloatingEmojis } from "./FloatingEmojis";

const SCENE_H = 360;
/** When the ticker stamps and your tokens' card rises (ms after the screen opens). */
const STAMP_AT = 1100;
const CARD_AT = 1400;
/** The moment's own cues stay quiet until the app is touched (a room opened by a link). */
const cue = (name) => {
  if (isArmed()) play(name);
};

/** Its children moving in (Move), or already in place when `settled`. */
function In({ settled, style, children, ...move }) {
  if (settled) return <View style={style}>{children}</View>;
  return (
    <Move {...move} style={style}>
      {children}
    </Move>
  );
}

/** `commit`: what this wallet put in (lamports, BigInt) or null. `claimed`: its tokens arrived.
 *  `again`: this screen showed before (the room is back in front): no liftoff, stamp or
 *  coins, and what moved in shows in place; tokens that arrive after it opens still rise in
 *  with `coins`. Read once, as it opens. */
export function MomentLive({ view, launched, who, wallet, claimed, commit, again, onShare, onClose }) {
  const insets = useSafeAreaInsets();
  const [settled] = useState(() => !!again);
  // your tokens' card shown already: in place and quiet
  const [cardSettled] = useState(() => !!again && claimed);
  const now = useNow(1000);
  const mint = launched?.mint;
  const holding = useStore(store, (s) => (mint ? s.holdings[mint] : undefined));
  const seenAt = useStore(store, (s) => (mint ? s.launchSeen[mint] : undefined));
  // this wallet's balance of the coin, while this screen is up
  useEffect(() => (mint ? store.getState().watchCoin(mint) : undefined), [mint]);

  const opened = useRef(Date.now());
  useEffect(() => {
    if (settled) return;
    cue("liftoff");
    const t = setTimeout(() => cue("stamp"), STAMP_AT);
    return () => clearTimeout(t);
  }, [settled]);
  useEffect(() => {
    if (!claimed || cardSettled) return;
    const t = setTimeout(() => cue("coins"), Math.max(0, opened.current + CARD_AT - Date.now()));
    return () => clearTimeout(t);
  }, [claimed, cardSettled]);

  const ticker = view.token?.symbol ?? "";
  const amount = positionOf(holding)?.tokens;
  const secs = secondsTo(lockEnds(launched, seenAt), now);
  const trade = () => {
    onClose();
    nextScreen("whoosh");
    router.push(`/coin/${view.presale}`);
  };

  return (
    <View style={{ flex: 1 }}>
      <Scene name="live" motion={settled ? "still" : "lift"} height={SCENE_H}>
        <View style={{ flex: 1, paddingTop: insets.top + 28, alignItems: "center", gap: 14 }}>
          <In settled={settled} kind="pop" delay={600}>
            <View style={{ backgroundColor: C.up, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 4 }}>
              <T style={{ fontFamily: F.bold, fontSize: 12, letterSpacing: 1.2 }} color={C.bg0}>LIVE ON METEORA</T>
            </View>
          </In>
          <In settled={settled} kind="pop" delay={300}>
            <CoinImage uri={view.token?.image} size={88} ticker={ticker} />
          </In>
          <In settled={settled} kind="stamp" delay={STAMP_AT}>
            <T style={{ fontFamily: F.bold, fontSize: 40 }}>{ticker ? `$${ticker}` : "Live"}</T>
          </In>
        </View>
        <FloatingEmojis channel={view.presale} />
      </Scene>
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.gutter, paddingTop: 4, gap: 12 }}>
        {claimed ? (
          <In settled={cardSettled} kind="rise" delay={CARD_AT}>
            <View
              style={{
                flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                borderRadius: 12, borderWidth: 1, borderColor: `${C.gold}73`, backgroundColor: C.goldSoft,
              }}
            >
              <Face wallet={wallet} size={36} ring={C.gold} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <CheckIcon color={C.gold} />
                  <T v="body" color={C.gold} style={{ fontFamily: F.semi }}>
                    {commit != null ? `Your tokens arrived · for ${solText(commit)} SOL` : "Your tokens arrived"}
                  </T>
                </View>
                {amount ? <T v="num" style={{ fontSize: 20 }}>{`${amount} $${ticker}`}</T> : null}
              </View>
            </View>
          </In>
        ) : null}
        <In settled={settled} kind="rise" delay={CARD_AT + 150}>
          <Card style={{ gap: 12, paddingHorizontal: 8 }}>
            <T v="label" style={{ paddingHorizontal: 6 }}>Launched by</T>
            <Crowd who={who} me={wallet} />
          </Card>
        </In>
      </ScrollView>
      <View style={{ paddingHorizontal: S.gutter, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 10 }}>
        <Button kind="up" title={secs > 0 ? `Trade in ${secs} s` : "Trade"} disabled={!launched || secs > 0} onPress={trade} />
        {onShare ? <Button kind="quiet" title="Share the win" onPress={onShare} /> : null}
        <Button kind="quiet" title="Close" onPress={onClose} />
      </View>
    </View>
  );
}
