// Mooner pictures for the page: one queue in front of the renderer, memory and Cache Storage in front of the queue.
// The 3D studio renderer is only fetched when the first picture is asked for.
import type { Pfp } from '../types'
import { pfpKey } from './traits'
import { RENDER_VERSION } from './version'

const CACHE = `mooner-pfp-v${RENDER_VERSION}`

/** Pixel sizes pictures are drawn at. */
export const PFP_SIZES = [128, 256, 512] as const
export type PfpSize = (typeof PFP_SIZES)[number]

/** The smallest drawn size that stays sharp at `css` pixels on this screen. */
export function pfpSizeFor(css: number): PfpSize {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return PFP_SIZES.find((s) => s >= css * dpr) ?? 512
}

interface Job {
  key: string
  pfp: Pfp
  px: PfpSize
  priority: number
  order: number
  done: Promise<string>
  resolve(url: string): void
  reject(e: unknown): void
}

const urls = new Map<string, string>()
const jobs = new Map<string, Job>()
const queue: Job[] = []
let order = 0
let running = false
let renderer: Promise<typeof import('./render')> | undefined

const keyOf = (pfp: Pfp, px: number) => `${pfpKey(pfp)}@${px}`

/** A picture already drawn at `px` or bigger, if there is one. */
export function pfpUrl(pfp: Pfp, px: PfpSize): string | undefined {
  for (const s of PFP_SIZES) {
    if (s < px) continue
    const url = urls.get(keyOf(pfp, s))
    if (url) return url
  }
  return undefined
}

/** The picture's URL once it is drawn. Higher priority goes first; among equals, the latest request. */
export function requestPfp(pfp: Pfp, px: PfpSize, priority = 0): Promise<string> {
  const ready = pfpUrl(pfp, px)
  if (ready) return Promise.resolve(ready)
  const key = keyOf(pfp, px)
  const queued = jobs.get(key)
  if (queued) {
    // Asked again: move it up.
    queued.priority = Math.max(queued.priority, priority)
    queued.order = ++order
    return queued.done
  }
  let resolve!: (url: string) => void, reject!: (e: unknown) => void
  const done = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  const job: Job = { key, pfp: { ...pfp }, px, priority, order: ++order, done, resolve, reject }
  jobs.set(key, job)
  queue.push(job)
  void pump()
  return done
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      queue.sort((a, b) => a.priority - b.priority || a.order - b.order)
      const job = queue.pop()!
      try {
        const url = URL.createObjectURL(await picture(job))
        urls.set(job.key, url)
        job.resolve(url)
      } catch (e) {
        job.reject(e)
      } finally {
        jobs.delete(job.key)
      }
      // Let the page breathe between pictures.
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    running = false
  }
}

async function picture(job: Job): Promise<Blob> {
  const req = `/__pfp/${job.key}`
  const store = await openCache()
  const hit = await store?.match(req).catch(() => undefined)
  if (hit) return hit.blob()
  renderer ??= import('./render')
  const blob = await (await renderer).renderPfp(job.pfp, job.px)
  await store?.put(req, new Response(blob, { headers: { 'content-type': blob.type } })).catch(() => {})
  return blob
}

let cache: Promise<Cache | undefined> | undefined
function openCache(): Promise<Cache | undefined> {
  cache ??= (async () => {
    if (typeof caches === 'undefined') return undefined
    try {
      for (const name of await caches.keys()) if (name.startsWith('mooner-pfp-') && name !== CACHE) await caches.delete(name)
      return await caches.open(CACHE)
    } catch {
      return undefined
    }
  })()
  return cache
}
