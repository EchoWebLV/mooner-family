// Launched: the coins out of presale, newest first, with their pools as the server pushes them.
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { launchedList } from "../../src/store";
import { CoinRow } from "../../src/launched/CoinRow";
import { Empty, Screen, T } from "../../src/ui/kit";
import { C, S } from "../../src/ui/theme";

export default function Launched() {
  const launched = useStore(store, (s) => s.launched);
  const solUsd = useStore(store, (s) => s.solUsd);
  const loaded = useStore(store, (s) => s.loaded.launched);
  const feedError = useStore(store, (s) => s.feedError.launched);
  const list = useMemo(() => launchedList({ launched }), [launched]);

  const renderItem = useCallback(
    ({ item }) => <CoinRow row={item} solUsd={solUsd} onPress={() => router.push(`/coin/${item.presale}`)} />,
    [solUsd],
  );

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: S.gutter, paddingTop: 12, minHeight: 56, justifyContent: "center" }}>
        <T v="title">Launched</T>
      </View>
      {loaded ? (
        <>
          {feedError && list.length > 0 ? (
            <T v="small" color={C.down} style={{ paddingHorizontal: S.gutter }}>{feedError}</T>
          ) : null}
          <FlatList
            data={list}
            keyExtractor={(r) => r.presale}
            renderItem={renderItem}
            contentContainerStyle={{ padding: S.gutter }}
            ItemSeparatorComponent={Gap}
            ListEmptyComponent={
              <Empty
                title="Nothing launched yet"
                body={feedError ? <T v="small" color={C.down}>{feedError}</T> : "Coins land here the moment their presale fills."}
              />
            }
          />
        </>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {feedError ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{feedError}</T> : null}
        </View>
      )}
    </Screen>
  );
}

const Gap = () => <View style={{ height: 12 }} />;
