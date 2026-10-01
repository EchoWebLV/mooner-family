// The join sheet: pick a seat, see what it costs, sign once in the wallet.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { seatChoices } from "../../../engine/src/views.js";
import { store } from "../app";
import { Chip } from "../ui/Chip";
import { solText } from "../ui/format";
import { CheckIcon } from "../ui/icons";
import { Button, Sheet, Steps, T } from "../ui/kit";
import { C } from "../ui/theme";
import { pickOf, shortOf } from "./room";

/** `view`: the room's presale view; `info`: store.info; `lamports`: the wallet's SOL (a
 *  number, or null while it's read); `signer`: useSigner(). `why` (text or null) says why a
 *  join can't go ahead now (the pool filled while the sheet was open, say). `onFailed` runs
 *  when a join fails, so the room can open the sheet again if it was closed meanwhile. */
export function JoinSheet({ open, onClose, onFailed, view, info, lamports, signer, why }) {
  const busy = useStore(store, (s) => s.busy);
  const choices = useMemo(() => seatChoices(info.N), [info]);
  const [chip, setChip] = useState(() => choices[0] ?? null);
  const [extra, setExtra] = useState(null);
  const [error, setError] = useState(null);

  // Each opening reads the cost afresh. The pick and a failed join's error stay until the
  // sheet is closed, so a join that fails after the sheet was closed still says why.
  useEffect(() => {
    if (!open) return;
    let on = true;
    store.getState().joinCost().then((x) => on && setExtra(x), () => {});
    return () => {
      on = false;
    };
  }, [open]);

  const joining = busy?.kind === "join" && busy.key === view.presale;
  const pick = chip == null ? null : pickOf(view, info.N, chip);
  const short = pick ? shortOf(pick.deposit, extra, lamports) : null;
  const ticker = view.token?.symbol ?? "";
  const blocked = !joining && why ? why : null;

  // Closed: the next opening starts from the smallest seat with no old error. A closing in
  // the middle of a join keeps the pick, which the error (if any) is about.
  const close = () => {
    setError(null);
    if (!joining) setChip(choices[0] ?? null);
    onClose();
  };

  async function join() {
    if (store.getState().busy) return;
    if (!pick || !signer) return;
    setError(null);
    const r = await store.getState().join(view.presale, pick.deposit, signer);
    Haptics.notificationAsync(r.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (r.ok) close();
    else {
      setError(r.error);
      onFailed?.();
    }
  }

  return (
    <Sheet open={open} onClose={close} title={`Join $${ticker}`}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {choices.map((c) => (
            <Chip key={String(c)} text={`${solText(c)} SOL`} on={c === chip} disabled={joining} onPress={() => setChip(c)} />
          ))}
        </View>
        {pick?.note ? <T v="small">{pick.note}</T> : null}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <CheckIcon color={C.up} />
            <T v="small" style={{ flex: 1 }}>Same price as everyone, creator included.</T>
          </View>
          <T v="small">Changed your mind? Get it all back with one tap until the pool fills.</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T v="small">Wallet</T>
          {lamports == null ? <ActivityIndicator size="small" color={C.text1} /> : <T v="num">{`${solText(lamports)} SOL`}</T>}
        </View>
        {short ? <T v="small" color={C.down}>{short}</T> : null}
        {blocked ? <T v="small" color={C.down}>{blocked}</T> : null}
        {error ? <T v="small" color={C.down}>{error}</T> : null}
        {joining ? <Steps step={busy.step} /> : null}
        <Button
          title={pick ? `Join · ${solText(pick.deposit)} SOL` : "Join"}
          onPress={join}
          busy={joining}
          disabled={!pick || !signer || !!short || !!blocked || (!!busy && !joining)}
        />
      </View>
    </Sheet>
  );
}
