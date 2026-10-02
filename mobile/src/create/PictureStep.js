// Step 1: the coin's picture, from the camera or the gallery, cropped square.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { CoinImage } from "../ui/CoinImage";
import { Button, T } from "../ui/kit";
import { C } from "../ui/theme";
import { PictureError, fromCamera, fromGallery, pendingPicture } from "./picture";

const SIZE = 200;

/** `picture`: { uri, bytes } or null. `onPicture` must keep its identity (a state setter). */
export function PictureStep({ picture, onPicture, onNext }) {
  const [opening, setOpening] = useState(null); // "camera" | "gallery" while it's open
  const [error, setError] = useState(null);
  const busy = useRef(false); // set before the picker opens, so a double tap can't open it twice

  // Android may close the app while the camera is open: the photo comes back on the next start.
  useEffect(() => {
    let on = true;
    pendingPicture().then(
      (p) => {
        if (on && p) {
          setError(null);
          onPicture(p);
        }
      },
      () => {},
    );
    return () => {
      on = false;
    };
  }, [onPicture]);

  async function pick(kind) {
    if (busy.current) return;
    busy.current = true;
    setOpening(kind);
    setError(null);
    try {
      const p = kind === "camera" ? await fromCamera() : await fromGallery();
      if (p) onPicture(p);
    } catch (e) {
      if (!(e instanceof PictureError)) console.warn(e); // the system's own error, for the log
      setError(e instanceof PictureError ? e.message : "Couldn't get that picture. Try again.");
    } finally {
      busy.current = false;
      setOpening(null);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        {picture ? (
          <CoinImage uri={picture.uri} size={SIZE} />
        ) : (
          <View
            style={{
              width: SIZE, height: SIZE, borderRadius: SIZE * 0.28, borderWidth: 1, borderStyle: "dashed",
              borderColor: C.lineStrong, backgroundColor: C.bg1, alignItems: "center", justifyContent: "center",
            }}
          >
            <T v="small" color={C.text2}>No picture yet</T>
          </View>
        )}
      </View>
      <T v="small" style={{ textAlign: "center" }}>It's cropped square and shows next to the ticker everywhere.</T>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" title="Camera" busy={opening === "camera"} disabled={!!opening} onPress={() => pick("camera")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" title="Gallery" busy={opening === "gallery"} disabled={!!opening} onPress={() => pick("gallery")} />
        </View>
      </View>
      {error ? <T v="small" color={C.down}>{error}</T> : null}
      <Button title="Next" disabled={!picture || !!opening} onPress={onNext} />
    </View>
  );
}
