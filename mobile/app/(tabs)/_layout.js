// The tabs: Live (open presales), Launched (coins out of presale), Create (a new coin and its
// presale), Me.
import { Tabs } from "expo-router";
import { LaunchedIcon, LiveIcon, MeIcon, PlusIcon } from "../../src/ui/icons";
import { C, F } from "../../src/ui/theme";

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
      <Tabs.Screen name="index" options={{ title: "Live", tabBarIcon: ({ color }) => <LiveIcon color={color} /> }} />
      <Tabs.Screen name="launched" options={{ title: "Launched", tabBarIcon: ({ color }) => <LaunchedIcon color={color} /> }} />
      <Tabs.Screen
        name="create"
        options={{ title: "Create", tabBarHideOnKeyboard: true, tabBarIcon: ({ color }) => <PlusIcon color={color} /> }}
      />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: ({ color }) => <MeIcon color={color} /> }} />
    </Tabs>
  );
}
