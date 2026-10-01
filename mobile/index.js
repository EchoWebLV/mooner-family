// Polyfills first: engine/src and web3.js expect Node's crypto and Buffer.
import "./polyfill";
import { registerRootComponent } from "expo";
import App from "./src/SpikeScreen";

registerRootComponent(App);
