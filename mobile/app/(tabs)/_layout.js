// The tabs: Pulse (presales filling, coins on the curve, migrated coins), Create (a new coin
// and its presale), Me (your face and SOL on its tab once known).
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { meTab } from "../../src/me";
import { Face } from "../../src/ui/Face";
import { LiveIcon, MeIcon, PlusIcon } from "../../src/ui/icons";
import { C, F } from "../../src/ui/theme";

/** Me's icon: your face once your SOL is known, else the outline. */
function MeTabIcon({ color }) {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const tab = meTab(wallet, lamports);
  return tab.face ? <Face wallet={tab.face} size={24} /> : <MeIcon color={color} />;
}

/** Me's label: your SOL in mono, else "Me". */
function MeTabLabel({ color }) {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const tab = meTab(wallet, lamports);
  return (
    <Text numberOfLines={1} style={{ fontFamily: tab.mono ? F.mono : F.medium, fontSize: tab.mono ? 11 : 12, color }}>
      {tab.label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg0 },
        tabBarStyle: { backgroundColor: C.bg1, borderTopColor: C.line, borderTopWidth: 1 },
        tabBarActiveTintColor: C.text0,
        tabBarInactiveTintColor: C.text2,
        tabBarLabelStyle: { fontFamily: F.medium, fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Pulse", tabBarIcon: ({ color }) => <LiveIcon color={color} /> }} />
      <Tabs.Screen
        name="create"
        options={{ title: "Create", tabBarHideOnKeyboard: true, tabBarIcon: ({ color }) => <PlusIcon color={color} /> }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarAccessibilityLabel: "Me",
          tabBarIcon: ({ color }) => <MeTabIcon color={color} />,
          tabBarLabel: ({ color }) => <MeTabLabel color={color} />,
        }}
      />
    </Tabs>
  );
}
