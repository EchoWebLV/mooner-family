// Your seat in the room: the gold card with what you have in (SeatCard), and the small quiet
// line under the buttons that takes it back (GetBack).
import { useState } from "react";
import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { solText } from "../ui/format";
import { LockIcon } from "../ui/icons";
import { Steps, T } from "../ui/kit";
import { C, F } from "../ui/theme";
import { seatPlan } from "./room";

/** The gold at 45%: the card's rim, as in the mockup. */
const GOLD_RIM = `${C.gold}73`;

/** `seat`: seatOf(view, wallet); `launched`: the launched row or undefined. */
export function SeatCard({ view, launched, seat, wallet, now }) {
  const busy = useStore(store, (s) => s.busy);
  const plan = seatPlan(view, launched, seat, wallet, now);
  // the seat can show up while its join is still going: the join's steps until it's done
  if (busy?.kind === "join" && busy.key === view.presale) return <Steps step={busy.step} />;
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 11,
        borderRadius: 12, borderWidth: 1, borderColor: GOLD_RIM, backgroundColor: C.goldSoft,
      }}
    >
      <Face wallet={wallet} size={32} ring={C.gold} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <T v="body" color={C.gold} style={{ fontFamily: F.semi }}>{plan.title}</T>
        {plan.note === "creator" ? (
          <Line icon={<LockIcon color={C.text1} />}>
            As the creator, your SOL stays in until launch. If the pool doesn't fill in time, it comes back by itself.
          </Line>
        ) : null}
        {plan.note === "locked" ? (
          <Line icon={<LockIcon color={C.text1} />}>Locked in. Your tokens come to your wallet right after launch.</Line>
        ) : null}
      </View>
    </View>
  );
}

/** "Get my X SOL back", when the seat can be taken back. `onBack(deposit)` runs when the SOL
 *  is back (the seat then leaves the view, and this with it). */
export function GetBack({ view, launched, seat, wallet, now, signer, onBack }) {
  const busy = useStore(store, (s) => s.busy);
  const [error, setError] = useState(null);
  const plan = seatPlan(view, launched, seat, wallet, now);
  const backing = busy?.kind === "back" && busy.key === view.presale;
  const joining = busy?.kind === "join" && busy.key === view.presale;

  async function getBack() {
    if (store.getState().busy) return;
    if (!signer) return;
    setError(null);
    const r = await store.getState().getBack(view.presale, signer);
    Haptics.notificationAsync(r.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (r.ok) onBack?.(seat.deposit);
    else setError(r.error);
  }

  if (joining || !plan.back) return null;
  const off = !signer || !!busy;
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      {backing ? <Steps step={busy.step} /> : null}
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: backing }}
        disabled={off}
        hitSlop={8}
        onPress={getBack}
        style={({ pressed }) => [
          { minHeight: 32, justifyContent: "center", paddingHorizontal: 12 },
          off && !backing && { opacity: 0.45 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <T v="small" color={C.text2}>{`Get my ${solText(seat.deposit)} SOL back`}</T>
      </Pressable>
    </View>
  );
}

/** A small line of text after an icon. */
export function Line({ icon, color = C.text1, children }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <T v="small" color={color} style={{ flex: 1 }}>{children}</T>
    </View>
  );
}
