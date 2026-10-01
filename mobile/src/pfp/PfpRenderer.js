// Mooner pictures on the phone. The web app draws them with three.js; the phone runs that
// same renderer in a hidden WebView on the app server's pfp.html (web/src/pfp-page.ts) and
// keeps each picture as a PNG in the app's cache folder (cache.js). The WebView is mounted
// only while a picture is missing from the folder. Until a picture is there, or when the page
// can't draw (a 404 before the page is deployed), faces show the fallback.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PixelRatio, View } from "react-native";
import { WebView } from "react-native-webview";
import { File, Paths } from "expo-file-system";
import { useStore } from "zustand";
import { store } from "../app";
import { BASE } from "../config";
import { makePfpCache, pfpKey } from "./cache";

const PAGE = `${BASE}/pfp.html`;
/** Pixel sizes the page draws at. */
const SIZES = [128, 256, 512];
/** Where the renderer version of the kept pictures is noted (not a picture name: forget()
 *  never deletes it). */
const VERSION_FILE = "pfp-version";

const inCache = (name) => new File(Paths.cache, name);

function savedVersion() {
  try {
    const file = inCache(VERSION_FILE);
    return (file.exists && file.textSync().trim()) || null;
  } catch {
    return null;
  }
}

const pictures = makePfpCache({
  origin: BASE,
  version: savedVersion(),
  saveVersion: (v) => inCache(VERSION_FILE).write(v),
  files: {
    uri: (name) => inCache(name).uri,
    exists: (name) => inCache(name).exists,
    write: (name, base64) => inCache(name).write(base64, { encoding: "base64" }),
    rename(from, to) {
      const old = inCache(to);
      if (old.exists) old.delete();
      inCache(from).rename(to);
    },
    remove(name) {
      const file = inCache(name);
      if (file.exists) file.delete();
    },
  },
});

/** The hidden page that draws the pictures, mounted while one is missing. It sits in the
 *  root layout under the screens; it never shows and never takes a touch. */
export function PfpRenderer() {
  const ref = useRef(null);
  const show = useSyncExternalStore(pictures.subscribe, pictures.wanted);
  const [mount, setMount] = useState(0); // a new WebView after Android stopped the page's process

  useEffect(() => {
    if (!show) return;
    pictures.open((text) => ref.current?.postMessage(text));
    return () => pictures.close();
  }, [show, mount]);

  if (!show) return null;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1 }}
    >
      <WebView
        key={mount}
        ref={ref}
        source={{ uri: PAGE }}
        style={{ width: 1, height: 1, position: "absolute", opacity: 0 }}
        javaScriptEnabled
        onMessage={(e) => pictures.message(e.nativeEvent.data, e.nativeEvent.url)}
        onError={(e) => pictures.fail(new Error(`the picture page didn't load: ${e.nativeEvent.description}`))}
        onHttpError={(e) => pictures.fail(new Error(`the picture page answered HTTP ${e.nativeEvent.statusCode}`))}
        onRenderProcessGone={(e) => {
          if (pictures.gone(e.nativeEvent.didCrash)) setMount((n) => n + 1);
        }}
      />
    </View>
  );
}

/** The file uri of `wallet`'s Mooner picture for a face `size` points wide, or null while
 *  there is none (show the fallback). Its saved traits come from the store's profiles; a
 *  wallet with none gets its default picture. */
export function usePfp(wallet, size) {
  const pfp = useStore(store, (s) => (wallet ? s.profiles[wallet] : undefined)) ?? null;
  const version = useSyncExternalStore(pictures.subscribe, pictures.version);
  const need = PixelRatio.getPixelSizeForLayoutSize(size);
  const px = SIZES.find((s) => s >= need) ?? 512;
  const name = useMemo(() => (wallet ? pfpKey(wallet, pfp, px, version) : null), [wallet, pfp, px, version]);
  const [got, setGot] = useState(() => (name ? { name, uri: pictures.cached(name) } : null));

  useEffect(() => {
    if (!name) return;
    return pictures.want(wallet, pfp, px, (uri) => setGot({ name, uri }));
  }, [name, wallet, pfp, px]);

  return got?.name === name ? got.uri : null;
}

/** A picture usePfp gave that wouldn't load: deleted, so it is drawn again next time. */
export function forgetPfp(uri) {
  pictures.forget(uri.slice(uri.lastIndexOf("/") + 1));
}
