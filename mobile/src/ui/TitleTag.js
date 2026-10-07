// A title's tag: "KOL II" in the title's colour on a soft fill of it.
import { Text, View } from "react-native";
import { TITLE_COLORS, tagText } from "../xp/look";
import { F, R } from "./theme";

/** Nothing without a title (a wallet with no title XP). */
export function TitleTag({ title, level }) {
  if (!title) return null;
  const color = TITLE_COLORS[title];
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ borderRadius: R.pill, backgroundColor: `${color}1f`, paddingHorizontal: 7, paddingVertical: 2 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 11, color }}>{tagText(title, level)}</Text>
      </View>
    </View>
  );
}
