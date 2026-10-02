// Step 4: a last look at the coin and what opening takes, then Open presale.
import { ActivityIndicator, View } from "react-native";
import { CoinImage } from "../ui/CoinImage";
import { solText } from "../ui/format";
import { LinkPills } from "../ui/LinkPills";
import { Button, Card, Steps, T } from "../ui/kit";
import { C } from "../ui/theme";

function Row({ label, children }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T v="small">{label}</T>
      {typeof children === "string" ? <T v="num">{children}</T> : children}
    </View>
  );
}

/** `fields`: rules.js mintFields(draft); `issued`: the server already has this coin (the
 *  wallet then signs once); `step`: the store's busy step while creating; `blocked`: another
 *  action is running; `waiting`: an open's outcome isn't known, and the screen watches for it.
 *  While waiting, `short` doesn't disable Open presale: the store reads the presale before
 *  its own funds check, and Start over needs that read. `onStartOver`: given only when
 *  rules.js canStartOver says yes (Task 7), else null. */
export function ReviewStep({ picture, fields, commit, extra, costFailed, target, minutes, issued, short, error, waiting, creating, step, blocked, canSign, onOpen, onStartOver }) {
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <CoinImage uri={picture?.uri} size={56} ticker={fields.symbol} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h2" numberOfLines={1}>{fields.name}</T>
            <T v="small">{`$${fields.symbol}`}</T>
          </View>
        </View>
        {fields.description ? <T v="small" color={C.text0}>{fields.description}</T> : null}
        <LinkPills token={{ links: fields.links }} />
      </Card>
      <View style={{ gap: 10 }}>
        <Row label="Your commit">{`${solText(commit)} SOL`}</Row>
        <Row label="Fees and rent">
          {extra != null ? `about ${solText(extra, 4)} SOL` : costFailed ? "Not known yet" : <ActivityIndicator size="small" color={C.text1} />}
        </Row>
        <Row label="Launches at">{`${solText(target)} SOL`}</Row>
        <Row label="Time to fill">{`${minutes} minutes`}</Row>
      </View>
      <T v="small">
        {issued
          ? "Your wallet asks once: to open the presale with your SOL."
          : "Your wallet asks twice: to sign the coin's details, then to open the presale with your SOL."}
      </T>
      {short ? <T v="small" color={C.down} accessibilityLiveRegion="polite">{short}</T> : null}
      {error ? <T v="small" color={C.down} accessibilityLiveRegion="polite">{error}</T> : null}
      {waiting ? (
        <T v="small">
          {onStartOver
            ? `No $${fields.symbol} presale showed up, and its last open is too old to go through now. Try it again, or start over with a new coin.`
            : "If it went through, the presale opens by itself. Trying again uses the same coin, so it can't open twice."}
        </T>
      ) : null}
      {creating ? <Steps step={step} /> : null}
      <Button title={`Open presale · ${solText(commit)} SOL`} onPress={onOpen} busy={creating} disabled={!canSign || blocked || (!!short && !waiting)} />
      {onStartOver ? <Button kind="quiet" title="Start over with a new coin" onPress={onStartOver} /> : null}
    </View>
  );
}
