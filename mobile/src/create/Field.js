// A labelled text field in the well: the accent rim while typing, the down rim and the
// problem under it when there's one, else the hint.
import { useState } from "react";
import { TextInput, View } from "react-native";
import { T } from "../ui/kit";
import { C, F, R } from "../ui/theme";

/** `error` and `hint`: text or nothing. Other props go to the TextInput. */
export function Field({ label, error, hint, multiline, ...input }) {
  const [focused, setFocused] = useState(false);
  const rim = error ? C.down : focused ? C.accent : C.wellLine;
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <TextInput
        {...input}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={C.text2}
        selectionColor={C.accentSoft}
        cursorColor={C.accent}
        selectionHandleColor={C.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minHeight: multiline ? 96 : 48, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 0,
          borderRadius: R.m, backgroundColor: C.well, borderWidth: 1, borderColor: rim,
          color: C.text0, fontFamily: F.regular, fontSize: 16, textAlignVertical: multiline ? "top" : "center",
        }}
      />
      {error ? <T v="small" color={C.down}>{error}</T> : hint ? <T v="small" color={C.text2}>{hint}</T> : null}
    </View>
  );
}
