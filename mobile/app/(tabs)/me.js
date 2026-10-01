// Me: the connected wallet (its face, address and SOL) and the presales it's in or was in;
// with no wallet, the same Connect Seed Vault as the Connect screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { rowsOf } from "../../src/me";
import { useConnect } from "../../src/useConnect";
import { useAccount, useWalletActions } from "../../src/wallet";
import { CoinImage } from "../../src/ui/CoinImage";
import { Face } from "../../src/ui/Face";
import { Logo } from "../../src/ui/Logo";
import { shortWallet, solText, usd } from "../../src/ui/format";
import { Button, Card, Empty, Pill, Screen, T } from "../../src/ui/kit";
import { C, F, R, S } from "../../src/ui/theme";

/** How long "Copied" shows after a copy. */
const COPIED_MS = 2_000;

/** The status pill's colour for each kind of row (me.js statusOf). */
const PILL = { launched: C.gold, back: C.text1, in: C.up, closed: C.text2 };

export default function Me() {
  const wallet = useStore(store, (s) => s.wallet);
  const account = useAccount();
  const { disconnect } = useWalletActions();
  const [leaving, setLeaving] = useState(false);
  const leavingNow = useRef(false); // set at once, so a second tap before the re-render does nothing

  // The store forgets the wallet first; if the adapter then fails to, Connect is still the
  // right place to go and there's nothing for the person to do about it.
  async function signOut() {
    if (leavingNow.current) return;
    leavingNow.current = true;
    setLeaving(true);
    try {
      await store.getState().signOut();
      await disconnect().catch(() => {});
      router.replace("/connect");
    } finally {
      leavingNow.current = false;
      setLeaving(false);
    }
  }

  let body;
  if (wallet) body = <Wallet wallet={wallet} leaving={leaving} onDisconnect={signOut} />;
  else if (account === undefined || leaving) body = <Loading />;
  else body = <SignedOut />;

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: S.gutter, paddingTop: 12, minHeight: 56, justifyContent: "center" }}>
        <T v="title">Me</T>
      </View>
      {body}
    </Screen>
  );
}

const Gap = () => <View style={{ height: 12 }} />;

const Loading = () => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
    <ActivityIndicator color={C.text1} />
  </View>
);

/** No wallet: the logo, what connecting gives, and Connect Seed Vault. Once connected, Me
 *  turns into the wallet's page (this unmounts, so it opens fresh next time). */
function SignedOut() {
  const { connect, busy, error } = useConnect();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: S.gutter, paddingBottom: 32 }}>
      <Logo size={96} />
      <T v="body" color={C.text1} style={{ textAlign: "center" }}>Connect your wallet to see your presales</T>
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Button title="Connect Seed Vault" onPress={connect} busy={busy} />
    </View>
  );
}

/** The wallet's page: its face, address and SOL, its presales, and Disconnect at the end, all
 *  in one list so the whole page scrolls. */
function Wallet({ wallet, leaving, onDisconnect }) {
  const lamports = useStore(store, (s) => s.lamports);
  const solUsd = useStore(store, (s) => s.solUsd);
  const presales = useStore(store, (s) => s.presales);
  const views = useStore(store, (s) => s.views);
  const launched = useStore(store, (s) => s.launched);
  const mine = useStore(store, (s) => s.mine);
  const rows = useMemo(
    () => rowsOf({ wallet, presales, views, launched, mine }),
    [wallet, presales, views, launched, mine],
  );

  const renderItem = useCallback(({ item }) => <PresaleRow row={item} />, []);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      renderItem={renderItem}
      contentContainerStyle={{ padding: S.gutter, paddingBottom: 32 }}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={<Profile wallet={wallet} lamports={lamports} solUsd={solUsd} />}
      ListEmptyComponent={<Empty title="You're not in any presale yet" body="Join one from Live." />}
      ListFooterComponent={
        <View style={{ marginTop: 32 }}>
          <Button title="Disconnect" kind="quiet" busy={leaving} onPress={onDisconnect} />
        </View>
      }
    />
  );
}

/** The face with a gold ring, the short address with Copy, the SOL (and its dollars when the
 *  price is known); "–" until the server has sent the balance. Then the list's label. */
function Profile({ wallet, lamports, solUsd }) {
  const known = lamports != null;
  return (
    <View>
      <View style={{ alignItems: "center", gap: 12, paddingTop: 8, paddingBottom: 28 }}>
        <Face wallet={wallet} size={96} ring={C.gold} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T v="num">{shortWallet(wallet)}</T>
          <CopyButton text={wallet} label="Copy the wallet address" />
        </View>
        <View style={{ alignItems: "center", gap: 2 }}>
          <T v="bigNum">{known ? `${solText(lamports, 3)} SOL` : "–"}</T>
          {known && solUsd > 0 ? <T v="small">{`≈ ${usd((lamports / 1e9) * solUsd)}`}</T> : null}
        </View>
      </View>
      <T v="label" style={{ marginBottom: 12 }}>Your presales</T>
    </View>
  );
}

/** "Copy": a tick of haptics, `text` on the clipboard, then "Copied" for COPIED_MS. */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const copy = () => {
    Haptics.selectionAsync().catch(() => {});
    Clipboard.setStringAsync(text).then(
      () => {
        if (!alive.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {},
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={copy}
      style={({ pressed }) => [
        {
          height: 30, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: C.bg2,
          borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <T style={{ fontFamily: F.medium, fontSize: 14 }} color={copied ? C.up : C.text0}>{copied ? "Copied" : "Copy"}</T>
    </Pressable>
  );
}

/** One of the wallet's presales: its coin (its short key while the coin isn't known yet) and
 *  where the wallet stands. A tap opens the presale, or the coin once it launched. */
function PresaleRow({ row }) {
  const { key, token, status } = row;
  return (
    <Card
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        router.push(status.to);
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CoinImage uri={token?.image} size={40} ticker={token?.symbol} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {token ? (
            <T v="h2" numberOfLines={1}>{`$${token.symbol}`}</T>
          ) : (
            <T v="num" color={C.text2} numberOfLines={1}>{shortWallet(key)}</T>
          )}
        </View>
        <Pill text={status.text} color={PILL[status.kind]} />
      </View>
    </Card>
  );
}
