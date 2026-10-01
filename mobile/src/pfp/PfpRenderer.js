// Mooner pictures on the phone. The web app draws them with three.js; the phone runs that
// same renderer in a hidden WebView on the app server's pfp.html (web/src/pfp-page.ts) and
// keeps each picture as a PNG in the app's cache folder, under pfp-v<renderer version>/
// (cache.js). The WebView is mounted only while a picture is missing, and once a run to hear
// the renderer version. Until a picture is there, or when the page can't draw (a 404 before
// the page is deployed), faces show the fallback.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PixelRatio, View } from "react-native";
import { WebView } from "react-native-webview";
import { Directory, File, Paths } from "expo-file-system";
import { useStore } from "zustand";
import { store } from "../app";
import { BASE } from "../config";
import { makePfpCache, pfpKey } from "./cache";

const PAGE = `${BASE}/pfp.html`;
/** Pixel sizes the page draws at. */
const SIZES = [128, 256, 512];
/** How long after the app starts the page is loaded to hear its renderer version, when no
 *  picture was missing. */
const CHECK_MS = 30_000;

// paths in the cache folder, as cache.js gives them: "pfp-v17/pfp-….png", "pfp-v17", ""
const fileAt = (path) => new File(Paths.cache, ...path.split("/"));
const folderAt = (path) => (path ? new Directory(Paths.cache, ...path.split("/")) : Paths.cache);
const nameOf = (uri) => uri.replace(/\/$/, "").split("/").pop();

const pictures = makePfpCache({
  origin: BASE,
  files: {
    uri: (path) => fileAt(path).uri,
    exists: (path) => fileAt(path).exists,
    list(path) {
      const folder = folderAt(path);
      return folder.exists ? folder.list().map((entry) => nameOf(entry.uri)) : [];
    },
    write(path, base64) {
      const [folder] = path.split("/");
      if (path.includes("/")) folderAt(folder).create({ intermediates: true, idempotent: true });
      fileAt(path).write(base64, { encoding: "base64" });
    },
    rename(from, to) {
      const old = fileAt(to);
      if (old.exists) old.delete();
      fileAt(from).rename(nameOf(to));
    },
    remove(path) {
      if (!path) return; // never the cache folder itself
      const folder = folderAt(path);
      if (folder.exists) return folder.delete(); // deletes what is in it too
      const file = fileAt(path);
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

  useEffect(() => {
    const t = setTimeout(pictures.check, CHECK_MS);
    return () => clearTimeout(t);
  }, []);

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
