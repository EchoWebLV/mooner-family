// Step 2: the coin's name, ticker, description and links. Problems show once Next was tried.
import { View } from "react-native";
import { Button, T } from "../ui/kit";
import { C } from "../ui/theme";
import { Field } from "./Field";
import { DESCRIPTION_MAX, NAME_MAX, TICKER_MAX, TICKER_MIN, normalizeTicker } from "./rules";

/** `draft`: rules.js blankDraft() as typed; `errors`: validate(draft); `tried`: Next was
 *  pressed once (the problems show from then on, and a line above Next says so: a field with
 *  a problem may be scrolled out of view). */
export function DetailsStep({ draft, onDraft, errors, tried, onNext }) {
  const set = (field, clean = (v) => v) => (v) => onDraft({ ...draft, [field]: clean(v) });
  const setLink = (kind) => (v) => onDraft({ ...draft, links: { ...draft.links, [kind]: v } });
  const shown = tried ? errors : {};
  const left = DESCRIPTION_MAX - draft.description.length;
  const link = { autoCapitalize: "none", autoCorrect: false };
  return (
    <View style={{ gap: 16 }}>
      <Field label="Name" value={draft.name} onChangeText={set("name")} error={shown.name} maxLength={NAME_MAX} autoCapitalize="words" />
      <Field
        label="Ticker"
        value={draft.ticker}
        onChangeText={set("ticker", normalizeTicker)}
        error={shown.ticker}
        hint={`${TICKER_MIN} to ${TICKER_MAX} letters or digits`}
        maxLength={TICKER_MAX}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Field
        label="Description (optional)"
        value={draft.description}
        onChangeText={set("description")}
        error={shown.description}
        hint={left === 1 ? "1 character left" : `${left} characters left`}
        maxLength={DESCRIPTION_MAX}
        multiline
      />
      <Field label="X (optional)" value={draft.links.x} onChangeText={setLink("x")} error={shown.x} placeholder="@handle or link" keyboardType="email-address" {...link} />
      <Field label="Telegram (optional)" value={draft.links.telegram} onChangeText={setLink("telegram")} error={shown.telegram} placeholder="@group or link" keyboardType="email-address" {...link} />
      <Field label="Website (optional)" value={draft.links.website} onChangeText={setLink("website")} error={shown.website} placeholder="yoursite.com" keyboardType="url" {...link} />
      {Object.keys(shown).length > 0 ? (
        <T v="small" color={C.down} accessibilityLiveRegion="polite">Fix the problems above to go on.</T>
      ) : null}
      <Button title="Next" onPress={onNext} />
    </View>
  );
}
