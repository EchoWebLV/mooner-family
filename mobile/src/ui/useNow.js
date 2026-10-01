import { useEffect, useState } from "react";

/** Date.now(), updated every `ms` while the screen is mounted and `on` is true. Off, it
 *  holds still; turned on again, it catches up at once. */
export function useNow(ms = 1000, on = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}
