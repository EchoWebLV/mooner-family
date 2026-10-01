// Live: the open presales, fullest first, as the server pushes them.
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { liveList } from "../../src/store";
import { PresaleCard } from "../../src/live/PresaleCard";
import { solText } from "../../src/ui/format";
import { Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { C, S } from "../../src/ui/theme";

export default function Live() {
  const presales = useStore(store, (s) => s.presales);
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const loaded = useStore(store, (s) => s.loaded.presales);
  const feedError = useStore(store, (s) => s.feedError.presales);
  const profiles = useStore(store, (s) => s.profiles);
  const list = useMemo(() => liveList({ presales }).filter((v) => v.token), [presales]);
  const ready = !!info && loaded;

  const renderItem = useCallback(
    ({ item }) => (
      <PresaleCard view={item} info={info} profiles={profiles} onPress={() => router.push(`/presale/${item.presale}`)} />
    ),
    [info, profiles],
  );

  return (
    <Screen padded={false}>
      <Header />
      {ready ? (
        <>
          {feedError && list.length > 0 ? (
            <T v="small" color={C.down} style={{ paddingHorizontal: S.gutter }}>{feedError}</T>
          ) : null}
          <FlatList
            data={list}
            keyExtractor={(v) => v.presale}
            renderItem={renderItem}
            contentContainerStyle={{ padding: S.gutter }}
            ItemSeparatorComponent={Gap}
            ListEmptyComponent={
              <Empty
                title="No presales right now"
                body={feedError ? <T v="small" color={C.down}>{feedError}</T> : "New ones show up here the moment they open."}
              />
            }
          />
        </>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {infoError || feedError ? (
            <T v="small" color={C.down} style={{ textAlign: "center" }}>{infoError || feedError}</T>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const Gap = () => <View style={{ height: 12 }} />;

/** "Live", and on the right the wallet's SOL, or a small "Connect" with no wallet. */
function Header() {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: S.gutter, paddingTop: 12, minHeight: 56,
      }}
    >
      <T v="title">Live</T>
      {!wallet ? (
        <PillButton title="Connect" onPress={() => router.push("/connect")} />
      ) : lamports == null ? (
        <ActivityIndicator size="small" color={C.text1} />
      ) : (
        <T v="num">{`${solText(lamports)} SOL`}</T>
      )}
    </View>
  );
}
