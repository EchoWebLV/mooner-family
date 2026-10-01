'use client'
// Creates the store, starts reading the server and the chain, ticks the clock once a second,
// and hands the store the signed-in wallet.
import { useLogin, usePrivy } from '@privy-io/react-auth'
import {
  useSignMessage,
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from '@privy-io/react-auth/solana'
import { PublicKey, Transaction, VersionedTransaction, type Connection, type SendOptions } from '@solana/web3.js'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { TICK_MS } from '@/lib/constants'
import { createAppStore, type AppState, type AppStore, type WalletLink } from '@/lib/store'

declare global {
  interface Window {
    /** The store, for looking at it from the console. */
    __mooner?: AppStore
  }
}

const StoreContext = createContext<AppStore | null>(null)

export function WorldProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createAppStore)
  useEffect(() => {
    const stop = store.getState().start()
    const id = window.setInterval(() => store.getState().tick(), TICK_MS)
    window.__mooner = store
    return () => {
      stop()
      window.clearInterval(id)
    }
  }, [store])
  return (
    <StoreContext value={store}>
      <WalletBridge store={store} />
      {children}
    </StoreContext>
  )
}

/** Keeps the store's wallet in step with Privy: the wallet the user signed in with, or the
 *  Privy wallet made for an email or X sign-in. */
function WalletBridge({ store }: { store: AppStore }) {
  const { authenticated, user, connectWallet } = usePrivy()
  const { wallets } = useWallets()
  const { signTransaction } = useSignTransaction()
  const { signMessage } = useSignMessage()
  // a fresh sign-in (not a page load that finds one) goes on to picking your Mooner
  const { login } = useLogin({
    onComplete: ({ wasAlreadyAuthenticated }) => {
      if (!wasAlreadyAuthenticated) store.getState().openSignIn()
    },
  })
  const wallet = authenticated ? (wallets.find((w) => w.address === user?.wallet?.address) ?? wallets[0]) : undefined
  // the signers change identity between renders; the link reads the latest ones
  const latest = useRef({ wallet, signTransaction, signMessage })
  latest.current = { wallet, signTransaction, signMessage }

  useEffect(() => {
    // signed in with a wallet that isn't connected right now (locked, other browser): connect it
    store.getState().setWalletPicker(() => (authenticated ? connectWallet() : login()))
  }, [store, authenticated, login, connectWallet])

  const address = wallet?.address ?? null
  useEffect(() => {
    store.getState().setWallet(address ? walletLink(address, () => latest.current) : null)
  }, [store, address])
  return null
}

interface Signers {
  wallet: ConnectedStandardSolanaWallet | undefined
  signTransaction: ReturnType<typeof useSignTransaction>['signTransaction']
  signMessage: ReturnType<typeof useSignMessage>['signMessage']
}

/** The store's view of a Privy wallet: web3.js transactions in, signed ones out. */
function walletLink(address: string, now: () => Signers): WalletLink {
  const current = () => {
    const s = now()
    if (s.wallet?.address !== address) throw new Error('Your wallet changed. Try again.')
    return { ...s, wallet: s.wallet }
  }
  async function sign<T>(tx: T): Promise<T> {
    const { wallet, signTransaction } = current()
    const v0 = tx instanceof VersionedTransaction
    const bytes = v0 ? tx.serialize() : (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false })
    const { signedTransaction } = await signTransaction({ transaction: bytes, wallet, chain: 'solana:mainnet' })
    return (v0 ? VersionedTransaction.deserialize(signedTransaction) : Transaction.from(signedTransaction)) as T
  }
  return {
    publicKey: new PublicKey(address),
    async signMessage(message) {
      const { wallet, signMessage } = current()
      return (await signMessage({ message, wallet })).signature
    },
    signTransaction: sign,
    async sendTransaction(tx: Transaction | VersionedTransaction, conn: Connection, opts?: SendOptions) {
      const signed = await sign(tx)
      return conn.sendRawTransaction(signed.serialize(), opts)
    },
  }
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

/** Keeps one presale or coin fresh while its page is open. True until its first read is back. */
export function useWatch(id: string): boolean {
  const store = useAppStore()
  const [reading, setReading] = useState<string | null>(id)
  useEffect(() => {
    setReading(id)
    return store.getState().watch(id, () => setReading((r) => (r === id ? null : r)))
  }, [store, id])
  return reading === id
}
