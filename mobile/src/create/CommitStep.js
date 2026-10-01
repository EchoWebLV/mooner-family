// Step 3: the creator's commit, which is also their seat: from the smallest seat up to the
// most the co-signer lets a creator put in, and whether the wallet covers it.
import { ActivityIndicator, View } from "react-native";
import { Chip } from "../ui/Chip";
import { solText } from "../ui/format";
import { Button, T } from "../ui/kit";
import { C } from "../ui/theme";

/** `choices`: rules.js commitChoices(N); `commit`: the pick (BigInt lamports); `extra`:
 *  openCost() (BigInt, null while it's read); `costFailed`: it couldn't be read; `lamports`:
 *  the wallet's SOL (a number, null while it's read); `short`: rules.js shortOfOpen(...);
 *  `target`: N.TARGET. */
export function CommitStep({ choices, commit, onCommit, extra, costFailed, lamports, short, target, onNext }) {
  const reading = extra == null && !costFailed;
  return (
    <View style={{ gap: 16 }}>
      <T v="body" color={C.text1}>
        You're first in. Your commit is your seat in the pool, at the same price as everyone. It stays in until launch; if the pool doesn't fill in time, it comes back to your wallet by itself.
      </T>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {choices.map((c) => (
          <Chip key={String(c)} text={`${solText(c)} SOL`} label={`Commit ${solText(c)} SOL`} on={c === commit} onPress={() => onCommit(c)} />
        ))}
      </View>
      <T v="small">{`It launches when ${solText(target)} SOL is in the pool.`}</T>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T v="small">Wallet</T>
        {lamports == null ? <ActivityIndicator size="small" color={C.text1} /> : <T v="num">{`${solText(lamports)} SOL`}</T>}
      </View>
      {costFailed ? (
        <T v="small">Couldn't read the fees and rent right now. You can still go on; Solana refuses the open if your SOL doesn't cover it.</T>
      ) : null}
      {short ? <T v="small" color={C.down}>{short}</T> : null}
      <Button title="Next" onPress={onNext} busy={reading} disabled={!!short} />
    </View>
  );
}
