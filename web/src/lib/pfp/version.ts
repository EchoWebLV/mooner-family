// The Mooner picture renderer's version, shared by the web's picture cache (load.ts) and the
// page the phone app draws pictures with (pfp-page.ts), so both draw again when it changes.

/** Bump when the renderer's output changes, so stored pictures are drawn again. */
export const RENDER_VERSION = 17
