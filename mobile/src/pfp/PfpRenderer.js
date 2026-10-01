// Mooner pictures on the phone. The web app draws them with three.js; the phone runs that
// same renderer in a hidden WebView on the app server's pfp.html (web/src/pfp-page.ts) and
// keeps each picture as a PNG in the app's cache folder (cache.js). Until a picture is there,
// or when the page can't draw (a 404 before the page is deployed), faces show the fallback.
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { File, Paths } from "expo-file-system";
import { useStore } from "zustand";
import { store } from "../app";
import { BASE } from "../config";
import { makePfpCache, pfpKey } from "./cache";

const PAGE = `${BASE}/pfp.html`;

const pictures = makePfpCache({
  files: {
    uri: (name) => new File(Paths.cache, name).uri,
    exists: (name) => new File(Paths.cache, name).exists,
    write: (name, base64) => new File(Paths.cache, name).write(base64, { encoding: "base64" }),
  },
});

/** The hidden page that draws the pictures. Mounted once, in the root layout; it never shows
 *  and never takes a touch. Once the page is down it is unmounted for the rest of the run. */
export function PfpRenderer() {
  const ref = useRef(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    if (down) return;
    pictures.open((text) => ref.current?.postMessage(text), () => setDown(true));
    return () => pictures.close();
  }, [down]);

  if (down) return null;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1 }}
    >
      <WebView
        ref={ref}
        source={{ uri: PAGE }}
        style={{ width: 1, height: 1, position: "absolute", opacity: 0 }}
        javaScriptEnabled
        onMessage={(e) => {
          if (e.nativeEvent.url?.startsWith(`${BASE}/`)) pictures.message(e.nativeEvent.data);
        }}
        onError={(e) => pictures.fail(new Error(`the picture page didn't load: ${e.nativeEvent.description}`))}
        onHttpError={(e) => pictures.fail(new Error(`the picture page answered HTTP ${e.nativeEvent.statusCode}`))}
        onRenderProcessGone={() => pictures.fail(new Error("the picture page stopped"))}
      />
    </View>
  );
}

/** The file uri of `wallet`'s Mooner picture for a face `size` points wide, or null while
 *  there is none (show the fallback). Its saved traits come from the store's profiles; a
 *  wallet with none gets its default picture. */
export function usePfp(wallet, size) {
  const pfp = useStore(store, (s) => (wallet ? s.profiles[wallet] : undefined)) ?? null;
  const px = size <= 64 ? 128 : 256;
  const name = useMemo(() => (wallet ? pfpKey(wallet, pfp, px) : null), [wallet, pfp, px]);
  const [got, setGot] = useState(() => (name ? { name, uri: pictures.cached(name) } : null));

  useEffect(() => {
    if (!name) return;
    let on = true;
    pictures.request(wallet, pfp, px).then(
      (uri) => on && setGot({ name, uri }),
      () => {},
    );
    return () => {
      on = false;
    };
  }, [name, wallet, pfp, px]);

  return got?.name === name ? got.uri : null;
}
