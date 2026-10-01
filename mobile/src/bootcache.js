// The wallet library's authorization cache, plus what the first screen needs to know while
// the library reads it back on a cold start: `read` (the read finished) and `has` (it found a
// selected account). Without them the library's account starts as null and looks the same as
// "never connected", so the app would open on Connect for a moment before the saved one loads.
//
// `saved` is secureJson's { get, set, clear }. Keystore calls can throw (expo-secure-store on
// Android). A failed read counts as nothing saved, so the person connects again. A failed
// write or delete is swallowed: the library sets its in-memory authorization only after
// set/clear return, so swallowing keeps connect, signing and disconnect working for this run.
// The library reads the cache once, on mount, so nothing reads the stale stored value back
// until the next cold start.

import { createStore } from "zustand/vanilla";

/** `fn()`'s result, or undefined if it throws or rejects */
async function quietly(fn) {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export function makeBootCache(saved) {
  const boot = createStore(() => ({ read: false, has: false }));
  const cache = {
    async get() {
      const auth = await quietly(() => saved.get());
      boot.setState({ read: true, has: !!auth?.selectedAccount });
      return auth;
    },
    async set(auth) {
      await quietly(() => saved.set(auth));
      boot.setState({ has: !!auth?.selectedAccount });
    },
    async clear() {
      await quietly(() => saved.clear());
      boot.setState({ has: false });
    },
  };
  return { cache, boot };
}
