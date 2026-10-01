import { Stack } from "expo-router";

export default function Root() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#07080b" } }} />;
}
