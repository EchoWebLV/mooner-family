// The coin's picture, from the camera or the gallery: Android's crop screen at 1:1 first,
// then the centred square of what it gave (in case it isn't quite square), at most 1024 px,
// as a JPEG. Each gives { uri, bytes } (bytes: a Uint8Array, what flows.requestMint signs
// and sends), or null when the person backed out.
import { Buffer } from "buffer";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { imageProblem, squareOf } from "./rules";

const PICK = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 };

/** An error in words for the screen (anything else is the system's, shown in general terms). */
export class PictureError extends Error {}

/** A photo from the camera. Asks for the camera first; after a "don't ask again", says
 *  where to allow it. */
export async function fromCamera() {
  let perm = await ImagePicker.getCameraPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PictureError("Mooner can't use the camera. Allow it in Settings, or choose from the gallery.");
  return finish(await ImagePicker.launchCameraAsync(PICK));
}

/** A picture from the gallery (Android's photo picker: no permission needed). */
export async function fromGallery() {
  return finish(await ImagePicker.launchImageLibraryAsync(PICK));
}

/** A picture taken just before Android closed the app to free memory (it can while the
 *  camera is open), or null. */
export async function pendingPicture() {
  const r = await ImagePicker.getPendingResultAsync();
  if (!r || "code" in r) return null; // nothing, or the picker's error ({ code, message })
  return finish(r);
}

async function finish(result) {
  if (result.canceled || !result.assets?.[0]) return null;
  const natives = []; // released at the end, whatever happens
  const hold = (x) => (natives.push(x), x);
  try {
    // decode first: the picker's width and height may not match the pixels (rotation)
    const decoded = hold(await hold(ImageManipulator.manipulate(result.assets[0].uri)).renderAsync());
    const { crop, size } = squareOf(decoded.width, decoded.height);
    const square = hold(await hold(ImageManipulator.manipulate(decoded)).crop(crop).resize({ width: size, height: size }).renderAsync());
    const saved = await square.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    const bytes = new Uint8Array(Buffer.from(saved.base64, "base64"));
    const problem = imageProblem(bytes);
    if (problem) throw new PictureError(problem);
    return { uri: saved.uri, bytes };
  } finally {
    for (const n of natives) {
      try {
        n.release();
      } catch {}
    }
  }
}
