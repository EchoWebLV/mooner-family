// Keeps a screen's bottom above the Android keyboard. The app draws edge to edge, so the
// window doesn't shrink for the keyboard: give the View that should end at the keyboard
// `ref` and `onLayout`, and pad its bottom by `pad` (0 while the keyboard is closed).
// keyboardDidShow's `screenY` is the keyboard's top from the top of the screen, and
// `measure`'s pageY is from the top of the root view, which is the top of the screen here
// (measureInWindow isn't: it also takes off the status bar). Android 11+ sends no event
// when the open keyboard changes height (its emoji panel), so `pad` keeps the first one.
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

/** `{ ref, onLayout, pad, open }`: `pad` is how far the keyboard covers the View's bottom,
 *  `open` whether the keyboard is up (and `pad` measured for it). */
export function useKeyboardPad() {
  const ref = useRef(null);
  const top = useRef(null); // the open keyboard's top, in dp from the screen's top
  const [pad, setPad] = useState(0);
  const [open, setOpen] = useState(false);

  const fit = useCallback(() => {
    const at = top.current;
    if (at == null || !ref.current) return;
    ref.current.measure((x, y, w, h, pageX, pageY) => {
      if (top.current !== at) return; // closed while this was measured
      setPad(Math.max(0, pageY + h - at));
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    const show = (e) => {
      top.current = e.endCoordinates.screenY;
      fit();
    };
    const hide = () => {
      top.current = null;
      setPad(0);
      setOpen(false);
    };
    if (Keyboard.isVisible()) show({ endCoordinates: Keyboard.metrics() });
    const subs = [Keyboard.addListener("keyboardDidShow", show), Keyboard.addListener("keyboardDidHide", hide)];
    return () => {
      top.current = null;
      subs.forEach((s) => s.remove());
    };
  }, [fit]);

  // the View can move while the keyboard is up (Create's tab bar hides for it), and the
  // padding never moves its bottom, so a new layout measures again
  return { ref, onLayout: fit, pad, open };
}
