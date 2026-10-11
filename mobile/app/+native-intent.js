// Links the system hands the router. The way back from X's sign-in (mooner://x-link?…) is for
// Link X on Me (WebBrowser reads it), not a screen: the router stays where it is. If it starts
// the app (Android let it go while X was open), Me opens, and reads the X account again.
import { isXBack } from "../src/xp/xlink";

export function redirectSystemPath({ path, initial }) {
  if (isXBack(path)) return initial ? "/me" : null;
  return path;
}
