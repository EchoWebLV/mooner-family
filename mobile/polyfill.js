// crypto.getRandomValues (web3.js makes keys with it), then one Buffer for everything: the
// `buffer` package, as the web app uses (engine/src calls Buffer.from).
import "react-native-get-random-values";
import { Buffer } from "buffer";

global.Buffer = Buffer;
