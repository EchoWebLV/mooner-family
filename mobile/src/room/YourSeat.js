// Your seat in the room's bottom area: what you have in, and the one button that takes it back.
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../app";
import { solText } from "../ui/format";
import { CheckIcon, LockIcon } from "../ui/icons";
import { Button, Steps, T } from "../ui/kit";
import { C } from "../ui/theme";
import { seatPlan } from "./room";

/** `seat`: seatOf(view, wallet); `launched`: the launched row or undefined; `onBack(deposit)`
 *  runs when the SOL is back (the seat then leaves the view, and this with it). */
export function YourSeat({ view, launched, seat, wallet, now, signer, onBack }) {
  const busy = useStore(store, (s) => s.busy);
  const [error, setError] = useState(null);
  const plan = seatPlan(view, launched, seat, wallet, now);
  const backing = busy?.kind === "back" && busy.key === view.presale;
  const joining = busy?.kind === "join" && busy.key === view.presale;
  const ticker = view.token?.symbol ?? "";

  async function getBack() {
    if (store.getState().busy) return;
    if (!signer) return;
    setError(null);
    const r = await store.getState().getBack(view.presale, signer);
    Haptics.notificationAsync(r.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (r.ok) onBack?.(seat.deposit);
    else setError(r.error);
  }

  // the seat can show up while its join is still going: the join's steps until it's done
  if (joining) return <Steps step={busy.step} />;

  return (
    <View style={{ gap: 10 }}>
      <T v="h2">{plan.title}</T>
      {plan.note === "creator" ? (
        <Line icon={<LockIcon color={C.text1} />}>
          As the creator, your SOL stays in until launch. If the pool doesn't fill in time, it comes back by itself.
        </Line>
      ) : null}
      {plan.note === "locked" ? (
        <Line icon={<LockIcon color={C.text1} />}>Locked in. Your tokens come to your wallet right after launch.</Line>
      ) : null}
      {plan.note === "claimed" ? (
        <>
          <Line icon={<CheckIcon color={C.gold} />} color={C.gold}>Your tokens arrived</Line>
          <Button title={`See $${ticker}`} onPress={() => router.push(`/coin/${view.presale}`)} />
        </>
      ) : null}
      {plan.back ? (
        <>
          {backing ? <Steps step={busy.step} /> : null}
          {error ? <T v="small" color={C.down}>{error}</T> : null}
          <Button
            kind="quiet"
            title={`Get my ${solText(seat.deposit)} SOL back`}
            onPress={getBack}
            busy={backing}
            disabled={!signer || (!!busy && !backing)}
          />
        </>
      ) : null}
    </View>
  );
}

function Line({ icon, color = C.text1, children }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <T v="small" color={color} style={{ flex: 1 }}>{children}</T>
    </View>
  );
}
