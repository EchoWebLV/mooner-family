// Piece 0: one bare screen that asks Seed Vault the spec's questions. Each result is shown
// and logged: adb logcat -s ReactNativeJS | grep "\[spike\]"
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PublicKey } from "@solana/web3.js";
import { MobileWalletProvider, useMobileWallet } from "@wallet-ui/react-native-web3js";
import { capabilitiesCheck, engineCheck, entryCheck, erCheck, noFeeCheck, sendCheck, signInCheck } from "./checks";
import { makeRunner } from "./runner";

const NETS = {
  mainnet: { chain: "solana:mainnet", endpoint: "https://api.mainnet-beta.solana.com" },
  devnet: { chain: "solana:devnet", endpoint: "https://api.devnet.solana.com" },
};
const IDENTITY = { name: "Mooner", uri: "https://mooner.family", icon: "assets/icon-180.png" };

/** Where one network's wallet authorization is kept. The library's default is one key for
 *  every network, so after a switch Connect would send the other network's auth_token and
 *  the screen would show its account. */
function authCache(net) {
  const key = `mwa-authorization:${net}`;
  return {
    async get() {
      const saved = await AsyncStorage.getItem(key);
      if (!saved) return undefined;
      try {
        // as the library's own cache does: each account's publicKey comes back a PublicKey
        return JSON.parse(saved, (k, v) => (k === "publicKey" ? new PublicKey(v) : v));
      } catch {
        return undefined;
      }
    },
    set: (auth) => AsyncStorage.setItem(key, JSON.stringify(auth)),
    clear: () => AsyncStorage.removeItem(key),
  };
}
const CACHES = { mainnet: authCache("mainnet"), devnet: authCache("devnet") };

// The log, the busy flag and the runner live here, above the wallet provider: switching
// network remounts the provider (its own connection and authorization) and keeps the log,
// and a timed-out check keeps the wallet blocked on both networks. Nothing switches or
// clears while a check runs.
export default function App() {
  const [net, setNet] = useState("mainnet");
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [runner] = useState(() =>
    makeRunner({
      show: (line) => {
        console.log(`[spike] ${line}`);
        setLines((l) => [...l, line]);
      },
      setBusy,
    }),
  );
  const whenIdle = (fn) => () => !runner.isBusy() && fn();
  return (
    <MobileWalletProvider
      key={net}
      cache={CACHES[net]}
      chain={NETS[net].chain}
      endpoint={NETS[net].endpoint}
      commitmentOrConfig="confirmed"
      identity={IDENTITY}
    >
      <Spike
        net={net}
        lines={lines}
        runner={runner}
        busy={busy}
        toggleNet={whenIdle(() => setNet(net === "mainnet" ? "devnet" : "mainnet"))}
        clear={whenIdle(() => setLines([]))}
      />
    </MobileWalletProvider>
  );
}

function Spike({ net, lines, runner, busy, toggleNet, clear }) {
  const w = useMobileWallet();
  const scroll = useRef(null);
  const wallet = w.account?.publicKey ?? null;

  // needsWallet: it needs a connected account. usesWallet: it opens a Seed Vault session or
  // changes the saved authorization. `log` is the runner's for this one run.
  const tap = (name, check, { needsWallet = true, usesWallet = true } = {}) => () =>
    runner.run(`${name} (${net})`, (log) => {
      if (needsWallet && !wallet) throw new Error("connect first");
      return check({ wallet, w, log, connection: w.connection });
    }, { usesWallet });

  const buttons = [
    ["Engine", tap("engine", engineCheck, { needsWallet: false, usesWallet: false })],
    ["Capabilities", tap("capabilities", capabilitiesCheck, { needsWallet: false })],
    ["Connect", tap("connect", async ({ log }) => log(`wallet: ${(await w.connect()).publicKey.toBase58()}`), { needsWallet: false })],
    ["Sign in", tap("sign in", signInCheck)],
    ["Entry tx", tap("entry tx", entryCheck)],
    ["ER tx", tap("ER tx", erCheck)],
    ["No-fee tx", tap("no-fee tx", noFeeCheck)],
    ["Send memo", tap("send memo", sendCheck)],
    // Clears this network's saved authorization on the phone; Seed Vault isn't asked. It waits
    // for a timed-out check: that check's authorize could save the authorization again after.
    ["Disconnect", tap("disconnect", async ({ log }) => (await w.disconnect(), log("disconnected")), { needsWallet: false })],
    [`Network: ${net}`, toggleNet],
    ["Clear", clear],
  ];

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <Text style={s.title}>Mooner spike {wallet ? `· ${wallet.toBase58().slice(0, 6)}…` : "· not connected"}</Text>
      <View style={s.grid}>
        {buttons.map(([label, onPress]) => (
          <Pressable key={label} onPress={onPress} style={[s.button, busy && s.dim]}>
            <Text style={s.buttonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {/* follows the newest line; the bottom padding keeps it clear of the navigation bar */}
      <ScrollView ref={scroll} style={s.log} contentContainerStyle={s.logEnd} onContentSizeChange={() => scroll.current?.scrollToEnd()}>
        {lines.map((l, i) => (
          <Text key={i} style={s.line} selectable>
            {l}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingTop: 48, paddingHorizontal: 16 },
  title: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  button: { backgroundColor: "#222", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  dim: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 15 },
  log: { flex: 1 },
  logEnd: { paddingBottom: 48 },
  line: { color: "#9f9", fontFamily: "monospace", fontSize: 12, marginBottom: 4 },
});
