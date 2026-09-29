import { SPRITE_MANIFEST } from './sprite-manifest'
export { SPRITE_MANIFEST }
export interface SpriteAtlas { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export type SpriteId = keyof typeof SPRITE_MANIFEST
