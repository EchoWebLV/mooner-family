// The site: the wireframe's screens on react-router, fed by the Mooner server, the chain and
// the signed-in wallet. Signing in is Privy: a Solana wallet (Phantom, Solflare, Backpack…
// show up by themselves), or email or X, which get a Privy wallet made for them.
import '@/real/polyfills.js'
import '@/globals.css'
import { PrivyProvider, usePrivy, type PrivyClientConfig } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { BadgesScreen } from '@/components/badges/BadgesScreen'
import { CreditsScreen } from '@/components/credits/CreditsScreen'
import { DiscoverScreen } from '@/components/discover/DiscoverScreen'
import { LaunchScreen } from '@/components/launch/LaunchScreen'
import { LeaderboardScreen } from '@/components/leaderboard/LeaderboardScreen'
import { MoonersScreen } from '@/components/pfp/MoonersScreen'
import { PresaleScreen } from '@/components/presale/PresaleScreen'
import { ProfileScreen } from '@/components/profile/ProfileScreen'
import { PulseScreen } from '@/components/rails/PulseScreen'
import { AppShell } from '@/components/shell/AppShell'
import { TokenScreen } from '@/components/token/TokenScreen'
import { NotFound } from '@/components/ui/NotFound'
import { useApp, WorldProvider } from '@/components/world/WorldProvider'
import { BOARDS, type Board } from '@/lib/leaderboard'
import { PUBLIC_RPC, SOLANA_RPC } from '@/real/chain.js'
import { noteRef } from '@/real/refs.js'

// the app's id in the Privy dashboard (public), from web/.env at build time
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string

const PRIVY: PrivyClientConfig = {
  loginMethods: ['wallet', 'email', 'twitter'],
  appearance: {
    theme: 'dark',
    accentColor: '#5468ff',
    logo: '/mooner.svg',
    landingHeader: 'Sign in to Mooner',
    walletChainType: 'solana-only',
    walletList: ['detected_solana_wallets', 'phantom'],
  },
  embeddedWallets: {
    // email and X sign-ins get a Solana wallet; a wallet sign-in uses that wallet
    solana: { createOnLogin: 'users-without-wallets' },
    ethereum: { createOnLogin: 'off' },
    // the Privy wallet signs without its own confirm screen: the button that asked for it
    // already says what it does
    showWalletUIs: false,
  },
  externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
  solana: {
    rpcs: {
      // the server's RPC (POST /api/rpc): Solana's public one answers 403 to a browser. The
      // server has no RPC socket, so subscriptions stay on the public one; the site only has
      // Privy sign (flows.js and swap.js send), so nothing subscribes there
      'solana:mainnet': {
        rpc: createSolanaRpc(SOLANA_RPC),
        rpcSubscriptions: createSolanaRpcSubscriptions(PUBLIC_RPC.replace(/^http/, 'ws')),
      },
    },
  },
}

const TITLES: Record<string, string> = {
  '/': 'Pulse',
  '/launch': 'Create a coin',
  '/leaderboard': 'Leaderboard',
  '/discover': 'Discover',
  '/badges': 'Badges',
  '/mooners': 'Mooners',
  '/credits': 'Credits',
}

function Title() {
  const { pathname } = useLocation()
  useEffect(() => {
    const name = TITLES[pathname]
    document.title = name ? `${name} · Mooner` : 'Mooner'
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function Presale() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  const ref = q.get('ref')
  // a shared link's `?ref=<wallet>`: kept until a join here lands (real/refs.js). Noted once
  // Privy knows whether you're signed in, and if you are, once the store has your wallet: on
  // a page load your own link would otherwise read as a friend's and replace theirs.
  const { ready, authenticated } = usePrivy()
  const me = useApp((s) => s.wallet?.publicKey.toBase58())
  const known = ready && (!authenticated || !!me)
  useEffect(() => {
    if (ref && known) noteRef(id, ref, me)
  }, [id, ref, known, me])
  return <PresaleScreen key={id} id={id} invite={q.get('invite') ?? undefined} />
}

function Token() {
  const { id = '' } = useParams()
  return <TokenScreen key={id} id={id} />
}

function Profile() {
  const { handle = '' } = useParams()
  return <ProfileScreen key={handle} handle={handle.replace(/^@/, '')} />
}

function Leaderboard() {
  const [q] = useSearchParams()
  const b = q.get('board') as Board | null
  return <LeaderboardScreen initialBoard={b && BOARDS.includes(b) ? b : 'overall'} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY}>
      <BrowserRouter>
        <WorldProvider>
          <Title />
          <AppShell>
            <Routes>
              <Route path="/" element={<PulseScreen />} />
              <Route path="/launch" element={<LaunchScreen />} />
              <Route path="/presale/:id" element={<Presale />} />
              <Route path="/token/:id" element={<Token />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/discover" element={<DiscoverScreen />} />
              <Route path="/badges" element={<BadgesScreen />} />
              <Route path="/mooners" element={<MoonersScreen />} />
              <Route path="/profile/:handle" element={<Profile />} />
              <Route path="/credits" element={<CreditsScreen />} />
              <Route path="*" element={<NotFound what="Page" hint="There's nothing at this address." />} />
            </Routes>
          </AppShell>
        </WorldProvider>
      </BrowserRouter>
    </PrivyProvider>
  </StrictMode>,
)
