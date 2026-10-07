// Create: a new coin and its presale in four steps (the picture, the details, your commit, a
// last look). The wallet signs the coin's details (the server pins them to IPFS and issues
// the coin), then the open with the creator's SOL; then the room opens with the share sheet
// up. A coin issued but never opened waits at the top, to open without signing its details
// again. An open whose outcome isn't known keeps its coin and watches its presale: it can
// only be retried, never become a second coin. The store saves that coin for the wallet
// before the wallet is asked (and again once it signs, and when an unknown is reported), so
// it comes back after a restart too. Start over shows only once the server's own 404 came
// more than 5 minutes after the coin was last saved. The launching picture sits on top with
// the host saying each step's line, and a step bar under it; once it scrolls away, a bg0
// strip fades in under the status bar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, BackHandler, Share, View } from "react-native";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { api, store } from "../../src/app";
import { CommitStep } from "../../src/create/CommitStep";
import { DetailsStep } from "../../src/create/DetailsStep";
import { PictureStep } from "../../src/create/PictureStep";
import { ReviewStep } from "../../src/create/ReviewStep";
import { Unopened } from "../../src/create/Unopened";
import {
  ALREADY_OPEN, backAction, blankDraft, canStartOver, commitChoices, draftOf, hasErrors, isUnknown, mintFields, openLanded,
  presaleKeyOf, restoredOpen, shortOfOpen, takenTickers, unopenedOf, validate,
} from "../../src/create/rules";
import { newPresaleShare } from "../../src/create/share";
import { useConnect } from "../../src/useConnect";
import { useAccount, useSigner } from "../../src/wallet";
import { Glass, GlassPill, SceneHeader } from "../../src/ui/Glass";
import { Host } from "../../src/ui/Host";
import { BackIcon } from "../../src/ui/icons";
import { useKeyboardPad } from "../../src/ui/keyboard";
import { Logo } from "../../src/ui/Logo";
import { Button, T } from "../../src/ui/kit";
import { isArmed } from "../../src/ui/sound";
import { C, F, S } from "../../src/ui/theme";
import { useAppActive } from "../../src/ui/useAppActive";

const STEPS = ["picture", "details", "commit", "review"];

const SCENE_PT = 210; // the launching picture, the status bar's room included

/** The step bar's names, one per STEPS entry. */
const STEP_NAMES = ["Picture", "Details", "Your seat", "Launch"];

/** What the host says on each step. */
const HOST_LINES = {
  picture: "Start with a picture. Square works best.",
  details: "Name it, and give it a ticker.",
  commit: "Pick your seat. You're the first one in.",
  review: "Last look. Then open the pool.",
};

// The presales whose landing has buzzed and pushed the room, for the app's run: an open that
// outlives its Creator (sign-out, then a reconnect) and the new Creator's watch both see it.
const landedOnce = new Set();

export default function Create() {
  const wallet = useStore(store, (s) => s.wallet);
  const opening = useStore(store, (s) => s.opening); // undefined until the wallet's saved open is read
  const account = useAccount();
  if (wallet && opening !== undefined) return <Creator key={wallet} wallet={wallet} saved={opening} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <CreateScene />
      {account === undefined || wallet ? <Loading /> : <SignedOut />}
    </View>
  );
}

/** The launching picture with "Create": Back (not while `locked`) past the first step, the
 *  step as "n / 4", and the host saying the step's line. Without `step` (signed out, loading):
 *  the picture and the title only. */
function CreateScene({ step, locked = false, onBack }) {
  const at = step ? STEPS.indexOf(step) : -1;
  const focused = useIsFocused();
  const active = useAppActive();
  return (
    <SceneHeader
      name="launching"
      height={SCENE_PT}
      motion="kenBurns"
      title="Create"
      left={at > 0 && !locked ? <Glass label="Back" onPress={onBack}><BackIcon color={C.text0} size={20} /></Glass> : null}
      right={
        step ? (
          // the step bar says the step to a screen reader
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <GlassPill text={`${at + 1} / ${STEPS.length}`} />
          </View>
        ) : null
      }
    >
      {step ? (
        <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: S.gutter, paddingBottom: 10 }}>
          <View style={{ maxWidth: 300 }}>
            <Host line={HOST_LINES[step]} sound={focused && active && isArmed()} />
          </View>
        </View>
      ) : null}
    </SceneHeader>
  );
}

/** Four 4 pt segments under the picture, Picture · Details · Your seat · Launch: done and
 *  current in green, the current name in white. A progress bar to a screen reader. */
function StepBar({ at }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Steps" // not the step again: a screen reader says the label, then the value
      accessibilityValue={{ min: 1, max: STEPS.length, now: at + 1, text: `Step ${at + 1} of ${STEPS.length}: ${STEP_NAMES[at]}` }}
      style={{ flexDirection: "row", gap: 6, paddingHorizontal: S.gutter, paddingTop: 4 }}
    >
      {STEP_NAMES.map((name, i) => (
        <View key={name} style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= at ? C.up : C.bg3 }} />
          <T numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 11, color: i === at ? C.text0 : C.text2 }}>{name}</T>
        </View>
      ))}
    </View>
  );
}

const Loading = () => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
    <ActivityIndicator color={C.text1} />
  </View>
);

/** No wallet: the logo, what connecting gives, and Connect Seed Vault. */
function SignedOut() {
  const { connect, busy, error } = useConnect();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: S.gutter, paddingBottom: 32 }}>
      <Logo size={96} />
      <T v="body" color={C.text1} style={{ textAlign: "center" }}>Connect your wallet to create a coin and open its presale</T>
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Button title="Connect Seed Vault" onPress={connect} busy={busy} />
    </View>
  );
}

/** The four steps for `wallet` (keyed by it, so another wallet starts afresh). `saved`: the
 *  store's `opening` when it mounts; later changes don't reach the state (the live `opening`
 *  is read for Start over only). */
function Creator({ wallet, saved }) {
  const signer = useSigner();
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const lamports = useStore(store, (s) => s.lamports);
  const presales = useStore(store, (s) => s.presales);
  const launched = useStore(store, (s) => s.launched);
  const busy = useStore(store, (s) => s.busy);
  const opening = useStore(store, (s) => s.opening); // the saved open as it is now, with its `at`

  // an open whose outcome wasn't known, saved for this wallet: back on the last look, locked
  // to its coin, watching its presale
  const [start] = useState(() => restoredOpen(saved));
  const [step, setStep] = useState(start?.step ?? "picture");
  const [picture, setPicture] = useState(start?.picture ?? null); // { uri, bytes }; bytes null for a coin already issued
  const [draft, setDraft] = useState(() => start?.draft ?? blankDraft());
  const [tried, setTried] = useState(false); // Next was pressed on the details: problems show
  const [commit, setCommit] = useState(start?.commit ?? null); // BigInt lamports; null: the smallest
  const [coin, setCoin] = useState(start?.coin ?? null); // the server's coin once issued ({ mint, symbol, ... })
  const [extra, setExtra] = useState(null); // openCost(), BigInt
  const [costFailed, setCostFailed] = useState(false);
  const [error, setError] = useState(start?.error ?? null);
  const [tokens, setTokens] = useState(null); // GET /api/wallet/<wallet>/tokens
  const [unknown, setUnknown] = useState(start?.unknown ?? null); // the presale key of an open whose outcome isn't known
  const [read, setRead] = useState(null); // the last retry's read: { verdict, at } (store openCoin)
  const [trying, setTrying] = useState(false); // open() runs: from the tap until it has handled the answer
  const acting = useRef(false); // open() or startOver() runs; set at once, so neither starts while the other does
  // false once this Creator is gone (sign-out replaces the tabs; another wallet remounts it)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const creating = busy?.kind === "create";
  const locked = creating || trying || !!unknown; // the coin stays, and Back stays put
  // only after the server's own 404, more than START_OVER_MS after the coin's last save
  const mayStartOver =
    !!unknown && !creating && !trying && opening?.presale === unknown && canStartOver(opening, read?.verdict, read?.at);
  const at = STEPS.indexOf(step);
  const taken = useMemo(() => takenTickers({ presales, launched }), [presales, launched]);
  const errors = useMemo(() => validate(draft, { taken }), [draft, taken]);
  const fields = useMemo(() => mintFields(draft), [draft]);
  const choices = useMemo(() => (info ? commitChoices(info.N) : []), [info]);
  const unopened = useMemo(() => unopenedOf(tokens, presales), [tokens, presales]);
  const pick = commit ?? choices[0] ?? null;
  const short = pick == null ? null : shortOfOpen(pick, extra, lamports);
  // at the start, and on the last look (where "open one of them first" shows): never over a coin being opened
  const showUnopened = !coin && unopened.length > 0 && (step === "picture" || step === "review");

  // The wallet's coins: read each time the tab is shown and after each try (no push for them).
  const readTokens = useCallback(() => {
    api.walletTokens(wallet).then(setTokens, () => {});
  }, [wallet]);
  useFocusEffect(readTokens);

  // What opening takes besides the commit: read on reaching the commit step.
  const needCost = step === "commit" || step === "review";
  useEffect(() => {
    if (!needCost) return;
    let on = true;
    setCostFailed(false);
    store.getState().openCost().then(
      (x) => on && setExtra(x),
      () => on && setCostFailed(true),
    );
    return () => {
      on = false;
    };
  }, [needCost]);

  // A fresh form. `key`: the presale that just settled (opened passes it), whose saved open is
  // cleared; none (Back's fresh start) clears nothing.
  const reset = useCallback(
    (key) => {
      setStep("picture");
      setPicture(null);
      setDraft(blankDraft());
      setTried(false);
      setCommit(null);
      setCoin(null);
      setError(null);
      setUnknown(null);
      setRead(null);
      if (key) store.getState().forgetOpening(wallet, key);
    },
    [wallet],
  );

  // Back a step; from the commit of a coin already issued, back to a fresh start; nothing
  // while locked. false on the first step, so Android's back leaves the tab as usual.
  const back = useCallback(() => {
    const action = backAction({ at, locked, issued: !!coin, step });
    if (action === "leave") return false;
    if (action === "stay") return true;
    setError(null);
    if (action === "restart") reset();
    else setStep(STEPS[at - 1]);
    return true;
  }, [at, locked, coin, step, reset]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", back);
      return () => sub.remove();
    }, [back]),
  );

  // The open landed: a success buzz, a fresh form (which stops the watch below before the room
  // starts its own, and clears the saved open), the room, and over it the share sheet, only
  // for an open that succeeded here (`share`): its words are made from that open. A presale
  // found later (the watch, ALREADY_OPEN) may have aged or closed since; the room's own Share
  // has its real numbers. The buzz, the room and the share once per presale for the app's run
  // (landedOnce): the store's answer and the watched presale can both bring it, in this Creator
  // or in one that came after it. Each Creator still resets its own form.
  const opened = useCallback(
    (key, symbol, share) => {
      reset(key);
      readTokens();
      if (landedOnce.has(key)) return;
      landedOnce.add(key);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(`/presale/${key}`);
      const words = share ? newPresaleShare({ key, symbol, wallet, commit: pick, N: info.N, now: Date.now() }) : null;
      if (words) Share.share(words, { dialogTitle: "Share this presale" }).catch(() => {});
    },
    [reset, readTokens, wallet, pick, info],
  );

  // An open whose outcome isn't known: watch its presale over the socket. Once it shows up,
  // the open landed, and it goes the way a success does. Not while a try runs: open() handles
  // its own answer first (a success here brings the share sheet), and every answer that keeps
  // the coin sets `trying` false, which runs this again.
  useEffect(() => {
    if (!unknown) return;
    return store.getState().watch(unknown);
  }, [unknown]);
  const landed = useStore(store, (s) => openLanded(unknown, s));
  useEffect(() => {
    if (landed && !creating && !trying) opened(unknown, coin?.symbol, false);
  }, [landed, creating, trying, unknown, coin, opened]);

  // Leaves the saved coin for a new one: only when canStartOver said yes (mayStartOver). The
  // form leaves the coin first, and Open presale waits until the saved coin is cleared.
  async function startOver() {
    if (!mayStartOver || acting.current) return;
    acting.current = true;
    const key = unknown;
    reset();
    try {
      await store.getState().forgetOpening(wallet, key);
    } finally {
      acting.current = false;
    }
    readTokens(); // the coin left shows under "Not opened yet"
  }

  function resume(t) {
    if (locked) return;
    setPicture({ uri: t.image, bytes: null });
    setDraft(draftOf(t));
    setCoin(t);
    setCommit(null);
    setError(null);
    setStep("commit");
  }

  function details() {
    setTried(true);
    if (!hasErrors(errors)) setStep("commit");
  }

  function failed(why) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setError(why);
    readTokens();
  }

  async function open() {
    if (acting.current || trying || store.getState().busy || !signer || pick == null) return;
    if (signer.publicKey.toBase58() !== wallet) return; // the wallet changed before the store did
    acting.current = true;
    setError(null);
    setRead(null);
    setTrying(true);
    try {
      let issued = coin;
      if (!issued) {
        const r = await store.getState().mintCoin({ ...fields, image: picture.bytes }, signer);
        if (!r.ok) return failed(r.error);
        issued = r.value;
        setCoin(issued);
        // signed out or another wallet while the details were signed: no open from a Creator
        // that's gone; the coin shows under "Not opened yet"
        if (!alive.current || store.getState().wallet !== wallet) return;
      }
      const key = presaleKeyOf(info, issued.mint);
      const r = await store.getState().openCoin({ ...fields, mint: issued.mint, presale: key, image: issued.image }, pick, signer);
      setRead(r.read ?? null); // a retry's read, for Start over
      if (r.ok) return opened(r.value, issued.symbol, true);
      if (r.error === ALREADY_OPEN) return opened(key, issued.symbol, false);
      if (isUnknown(r.error)) setUnknown(key); // the coin stays (the store saved it); the watch above sees it land
      failed(r.error);
    } finally {
      acting.current = false;
      setTrying(false); // after opened() above, so the watch can't take a success first
    }
  }

  // A bg0 strip under the status bar, solid once the picture's bottom reaches it: the steps
  // never scroll under a bare status bar.
  const insets = useSafeAreaInsets();
  const kb = useKeyboardPad(); // the steps end at the keyboard's top, so a field can scroll above it
  const scrollRef = useRef(null);
  if (!scrollRef.current) scrollRef.current = new Animated.Value(0);
  const scrollY = scrollRef.current;
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  const scrim = useMemo(() => {
    const solidAt = Math.max(1, SCENE_PT - insets.top);
    return scrollY.interpolate({ inputRange: [Math.max(0, solidAt - 80), solidAt], outputRange: [0, 1], extrapolate: "clamp" });
  }, [scrollY, insets.top]);

  let body;
  if (step === "picture") {
    body = <PictureStep picture={picture} onPicture={setPicture} onNext={() => setStep("details")} />;
  } else if (step === "details") {
    body = <DetailsStep draft={draft} onDraft={setDraft} errors={errors} tried={tried} onNext={details} />;
  } else if (!info) {
    body = infoError ? <T v="small" color={C.down}>{infoError}</T> : <ActivityIndicator color={C.text1} />;
  } else if (step === "commit") {
    body = (
      <CommitStep
        choices={choices}
        commit={pick}
        onCommit={setCommit}
        extra={extra}
        costFailed={costFailed}
        lamports={lamports}
        short={short}
        target={info.N.TARGET}
        onNext={() => setStep("review")}
      />
    );
  } else {
    body = (
      <ReviewStep
        picture={picture}
        fields={fields}
        commit={pick}
        extra={extra}
        costFailed={costFailed}
        target={info.N.TARGET}
        minutes={Math.round(Number(info.N.DURATION) / 60)}
        issued={!!coin}
        short={short}
        error={error}
        waiting={!!unknown}
        creating={creating}
        step={creating ? busy.step : null}
        blocked={!!busy && !creating}
        canSign={!!signer}
        onOpen={open}
        onStartOver={mayStartOver ? startOver : null}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <View ref={kb.ref} onLayout={kb.onLayout} style={{ flex: 1, paddingBottom: kb.pad }}>
        <Animated.ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <CreateScene step={step} locked={locked} onBack={back} />
          <StepBar at={at} />
          <View style={{ padding: S.gutter, gap: 16 }}>
            {showUnopened ? <Unopened tokens={unopened} onOpen={resume} /> : null}
            {body}
          </View>
        </Animated.ScrollView>
      </View>
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: C.bg0, opacity: scrim }}
      />
    </View>
  );
}
