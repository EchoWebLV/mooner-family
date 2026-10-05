// The Buy and Sell sheets: pick an amount, see what you get, the price impact, the fee and
// the slippage, then sign once in the wallet. Jupiter routes the trade through the coin's
// Meteora pool.
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useNavigation } from "expo-router";
import { useStore } from "zustand";
import { sellAmount } from "../../../engine/src/swap.js";
import { store } from "../app";
import { Button, PillButton, Sheet, Steps, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { isArmed, play } from "../ui/sound";
import { C, F, R } from "../ui/theme";
import { useNow } from "../ui/useNow";
import { atMigration } from "./coin";
import { BUY_CHIPS, parseSol, secondsTo, SELL_PCTS, solSig, tokensText, tradeLines, whyNot } from "./trade";

/** How long the amount must sit still before the sheet asks Jupiter for a price. */
const QUOTE_AFTER_MS = 400;

/** One sheet per side, both kept mounted (as the join sheet is), so a trade that fails after
 *  its sheet was closed still says why when it opens again. `side`: "buy" | "sell"; `row`:
 *  the launched row; `holding`: the wallet's balance of the
 *  coin ({ raw, decimals, ui } or undefined while it's read); `lamports`: the wallet's SOL;
 *  `opensAt`: when trading opens (ms, trade.js lockEnds); `onDone(text)`: a trade landed. */
export function TradeSheet({ open, side, onClose, onDone, row, holding, lamports, signer, opensAt }) {
  const busy = useStore(store, (s) => s.busy);
  const [chip, setChip] = useState(side === "buy" ? BUY_CHIPS[0] : SELL_PCTS[0]);
  const [typed, setTyped] = useState("");
  const [priced, setPriced] = useState(null); // { amount, ok, value | error, noRoute }
  const [error, setError] = useState(null);
  const asked = useRef(0);
  const mint = row.mint;
  const symbol = row.token?.symbol ?? "";
  const buying = side === "buy";

  // The sheet's own sounds (a quote's `tick`, a buy's `coins`) arrive late, from a promise:
  // quiet unless the app was touched, is in front and this coin's screen has focus when the
  // sound is due. Each is read live then: isFocused() reads the navigator's state now, so a
  // coin screen gone back from (unmounted) reads as not focused.
  const navigation = useNavigation();
  const cue = (name) => {
    if (isArmed() && navigation.isFocused() && AppState.currentState === "active") play(name);
  };

  const amount = useMemo(() => {
    if (buying) return typed ? parseSol(typed) : chip;
    if (!(holding?.raw > 0n)) return null;
    const raw = sellAmount(holding.raw, chip);
    return raw > 0n ? raw : null; // 25% of a few raw units can round to nothing
  }, [buying, typed, chip, holding]);

  // Locked until the snipe tax is over: a 1 s clock re-renders the countdown meanwhile (it
  // reads no server); the seconds come from the clock now, so an unrelated render can't
  // leave a stale count behind. `opensAt` counts from the later of the server's launch time
  // and when this phone heard of the launch (trade.js lockEnds), so a phone clock that runs
  // fast doesn't open a launch it saw live early; a coin first seen in a snapshot has only
  // the server's time.
  const locked = opensAt != null && Date.now() < opensAt;
  useNow(1000, open && locked);
  const secs = locked ? secondsTo(opensAt, Date.now()) : 0;

  // A price once the amount sits still and the lock is over: one ask per amount the user
  // picks (and one when the lock ends), never on a timer. A price from inside the tax's
  // seconds would be stale by the time Buy opens. Any change to the amount, the opening or
  // the lock drops a price still on its way, so an old amount's quote never ticks.
  const ask = (a) => {
    const n = ++asked.current;
    setPriced(null);
    if (a == null) return;
    store.getState().preview(side, mint, a).then((r) => {
      if (n !== asked.current) return;
      setPriced({ amount: a, ...r });
      if (r.ok) cue("tick");
    });
  };
  useEffect(() => {
    asked.current++;
    if (!open || locked) return;
    const t = setTimeout(() => ask(amount), QUOTE_AFTER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, amount, locked]);

  const trading = busy?.key === mint && busy.kind === side;
  const failed = !locked && priced?.ok === false && priced.amount === amount ? priced : null;
  const q = !locked && priced?.ok && priced.amount === amount ? priced.value : null;
  const pools = [row.pool?.address, row.pool?.damm].filter(Boolean);
  // a migrated coin's sqrtPrice is the one at migration until its DAMM v2 pool is found: no
  // live price then, so the impact is Jupiter's own
  const sqrtPrice = atMigration(row.pool) ? null : row.pool?.sqrtPrice ?? null;
  const lines = q ? tradeLines(side, q, { pools, sqrtPrice, symbol }) : null;
  const why = whyNot({ side, secs, amount, lamports, holding, pct: chip, symbol, busy, trading });

  // Closed: the next opening starts from the first chip, with no old error and no old price.
  // A closing in the middle of a trade keeps the amount, which the error (if any) is about.
  const close = () => {
    setError(null);
    asked.current++;
    setPriced(null);
    if (!trading) {
      setTyped("");
      setChip(buying ? BUY_CHIPS[0] : SELL_PCTS[0]);
    }
    onClose();
  };

  // One signature, at a fresh price: one that no longer reaches the minimum shown comes back
  // unsigned, and the sheet shows it so the next press is at the new numbers.
  async function go() {
    if (store.getState().busy || amount == null || !signer || !q) return;
    setError(null);
    const n = asked.current; // moves on if the sheet closes or the amount changes meanwhile
    const r = await store.getState().trade(side, mint, amount, signer, { atLeast: q.minOut });
    const buzz = r.ok ? "Success" : r.moved ? "Warning" : "Error";
    Haptics.notificationAsync(Haptics.NotificationFeedbackType[buzz]).catch(() => {});
    if (r.moved) {
      const shown = n === asked.current; // the sheet is still open at this amount
      asked.current++; // a price still on its way is older than this one
      setPriced({ amount, ok: true, value: r.value.quote });
      if (shown) cue("tick"); // a quote value arrived
    }
    if (!r.ok) return setError(r.error);
    if (buying) cue("coins");
    const got = r.value.quote.outAmount;
    onDone?.(buying ? `Bought about ${tokensText(got)} $${symbol}` : `Sold for about ${solSig(got)} SOL`);
    close();
  }

  const title = buying ? (amount != null ? `Buy · ${solSig(amount)} SOL` : "Buy") : `Sell ${chip}%`;
  return (
    <Sheet open={open} onClose={close} title={`${buying ? "Buy" : "Sell"} $${symbol}`}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(buying ? BUY_CHIPS : SELL_PCTS).map((c) => (
            <Chip
              key={String(c)}
              text={buying ? `${solSig(c)} SOL` : `${c}%`}
              label={buying ? undefined : `Sell ${c}%`}
              on={c === chip && !typed}
              disabled={trading}
              onPress={() => {
                setTyped("");
                setChip(c);
              }}
            />
          ))}
        </View>
        {buying ? (
          <TextInput
            value={typed}
            onChangeText={setTyped}
            editable={!trading}
            keyboardType="decimal-pad"
            placeholder="Or type SOL"
            placeholderTextColor={C.text2}
            accessibilityLabel="SOL to spend"
            style={{
              height: 44, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: C.well,
              borderWidth: 1, borderColor: C.wellLine, color: C.text0, fontFamily: F.mono, fontSize: 15,
            }}
          />
        ) : (
          <Line label="You hold" value={holding ? `${tokensText(holding.raw)} $${symbol}` : "Reading…"} still />
        )}
        {typed && amount == null ? <T v="small" color={C.down}>Type an amount of SOL, like 0.25.</T> : null}
        <View style={{ gap: 8 }}>
          <Line label="You get about" value={lines?.get ?? (failed ? "–" : "…")} />
          <Line label="At least (slippage)" value={lines ? `${lines.minimum} · ${lines.slippage}` : "…"} />
          <Line label="Price impact" value={lines?.impact ?? "…"} color={lines?.high ? C.down : undefined} />
          <Line label="Fee" value={lines?.fee ?? "…"} />
          <T v="small" color={C.text2}>
            {buying ? "Plus Solana's network fee, and on a first buy the rent of your token account for this coin." : "Plus Solana's network fee."}
          </T>
        </View>
        {failed ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <T v="small" color={C.down} style={{ flex: 1 }}>{failed.error}</T>
            <PillButton title="Try again" onPress={() => ask(amount)} />
          </View>
        ) : null}
        {why ? <T v="small" color={why.wait ? C.warn : C.down}>{why.text}</T> : null}
        {error ? <T v="small" color={C.down}>{error}</T> : null}
        {trading ? <Steps step={busy.step} /> : null}
        <Button
          title={title}
          kind={buying ? "primary" : "quiet"}
          onPress={go}
          busy={trading}
          disabled={amount == null || !signer || !q || !!why || (!!busy && !trading)}
        />
      </View>
    </Sheet>
  );
}

/** A label on the left, its value on the right. A new quote value rises in; "…" (waiting)
 *  doesn't, and neither does a `still` line's (the balance, which isn't a quote value). */
function Line({ label, value, color, still = false }) {
  const text = <T v="num" color={color} style={{ textAlign: "right" }}>{value}</T>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T v="small">{label}</T>
      {still || value === "…" ? (
        <View style={{ flexShrink: 1 }}>{text}</View>
      ) : (
        <Move kind="rise" key={value} style={{ flexShrink: 1 }}>
          {text}
        </Move>
      )}
    </View>
  );
}

/** An oval amount chip, as in the join sheet. `label`: what a screen reader says, if not `text`. */
function Chip({ text, label, on, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          flex: 1, height: 44, borderRadius: R.pill, borderWidth: 1, alignItems: "center", justifyContent: "center",
          backgroundColor: on ? C.accentSoft : C.bg2, borderColor: on ? C.accent : C.lineStrong,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <T style={{ fontFamily: F.semi, fontSize: 15 }}>{text}</T>
    </Pressable>
  );
}
