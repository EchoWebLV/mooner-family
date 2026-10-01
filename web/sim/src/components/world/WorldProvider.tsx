'use client'
// Creates the demo world in the browser and ticks it once a second (spec §7.4).
// The server and the first client render show the boot screen, so markup never disagrees.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { TICK_MS } from '@/lib/constants'
import { createAppStore, type AppState, type AppStore, type Session } from '@/lib/store'
import { BootScreen } from './BootScreen'

declare global {
  interface Window {
    /** Development only: the demo store, for driving the world from the console or a test script. */
    __mooner?: AppStore
  }
}

const StoreContext = createContext<AppStore | null>(null)

const subscribeNothing = () => () => {}

export function WorldProvider({ children }: { children: ReactNode }) {
  const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false)
  return inBrowser ? <LiveWorld>{children}</LiveWorld> : <BootScreen />
}

/** Your sign-in and Mooner, kept in this browser. */
const SESSION_KEY = 'mooner-sim:session'
/** Set once the sign-in window has opened by itself, so it asks once per visit, not on every reload. */
const ASKED_KEY = 'mooner-sim:asked-sign-in'

function LiveWorld({ children }: { children: ReactNode }) {
  const [store] = useState(() => createAppStore(undefined, undefined, loadSession()))
  useEffect(() => {
    const id = window.setInterval(() => store.getState().tick(), TICK_MS)
    if (import.meta.env.DEV) window.__mooner = store
    return () => window.clearInterval(id)
  }, [store])
  useEffect(() => {
    const save = (s: AppState) => {
      try {
        if (s.signedIn) localStorage.setItem(SESSION_KEY, JSON.stringify({ pfp: s.world.users[s.world.meId].pfp }))
        else localStorage.removeItem(SESSION_KEY)
      } catch {}
    }
    const off = store.subscribe((s, prev) => {
      if (s.signedIn !== prev.signedIn || s.world.users[s.world.meId].pfp !== prev.world.users[prev.world.meId].pfp)
        save(s)
    })
    if (!store.getState().signedIn && !asked()) store.getState().openSignIn()
    return off
  }, [store])
  return <StoreContext value={store}>{children}</StoreContext>
}

function loadSession(): Session | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const data: unknown = raw && JSON.parse(raw)
    return data && typeof data === 'object' && 'pfp' in data ? { pfp: data.pfp as Session['pfp'] } : undefined
  } catch {
    return undefined
  }
}

/** True if the sign-in window already opened by itself this visit; marks it as opened either way. */
function asked(): boolean {
  try {
    if (sessionStorage.getItem(ASKED_KEY)) return true
    sessionStorage.setItem(ASKED_KEY, '1')
  } catch {}
  return false
}

export function useAppStore(): AppStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useAppStore must be used inside <WorldProvider>')
  return store
}

/**
 * Subscribes to a slice of the app state. The selector must return a stable value
 * (a primitive or an object already in the state), never a freshly built array or object.
 */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useAppStore(), selector)
}
