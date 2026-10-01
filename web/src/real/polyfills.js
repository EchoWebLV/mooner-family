// engine/src uses Node's Buffer; the browser gets the `buffer` package. Imported first.
import { Buffer } from "buffer";

globalThis.Buffer ??= Buffer;
