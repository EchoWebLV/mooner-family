// The phone's secrets, in Android Keystore through expo-secure-store (spec, Security): the
// seats' session keys (flows.js `keys`), the wallet's authorization and the Mooner sign-in.
// `store` is the expo-secure-store module, passed in so this file runs in Node tests.

/** A key expo-secure-store accepts (letters, digits, ".", "-", "_"); anything else becomes
 *  "_". Mooner's own names are `mooner:...` with base58 parts, and `mwa-authorization:...`.
 *  This keeps two of them apart only because those names never contain "_". */
export const safeName = (name) => name.replace(/[^A-Za-z0-9._-]/g, "_");

/** flows.js `keys`: { get(name), set(name, value) }. */
export function secureKeys(store) {
  return {
    get: async (name) => (await store.getItemAsync(safeName(name))) ?? null,
    set: (name, value) => store.setItemAsync(safeName(name), value),
  };
}

/** One JSON value under `name`: { get, set, clear }, the shape the wallet library takes for
 *  its authorization cache. `revive` is JSON.parse's reviver. A value that doesn't parse
 *  reads as missing. */
export function secureJson(store, name, revive) {
  const key = safeName(name);
  return {
    async get() {
      const s = await store.getItemAsync(key);
      if (!s) return undefined;
      try {
        return JSON.parse(s, revive);
      } catch {
        return undefined;
      }
    },
    set: (value) => store.setItemAsync(key, JSON.stringify(value)),
    clear: () => store.deleteItemAsync(key),
  };
}
