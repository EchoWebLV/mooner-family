// The simulation: the wireframe's screens and its simulated world (made-up coins, players and
// SOL, real meme photos), on react-router under /sim. Nothing here talks to the server or a chain.
import '@/globals.css'
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
import { WorldProvider } from '@/components/world/WorldProvider'
import { BOARDS } from '@/lib/leaderboard'
import { handleFromParam } from '@/lib/profile'

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
    document.title = name ? `${name} · Mooner simulation` : 'Mooner simulation'
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function Presale() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  return <PresaleScreen key={id} id={id} invite={q.get('invite') ?? undefined} />
}

function Token() {
  const { id = '' } = useParams()
  return <TokenScreen key={id} id={id} />
}

function Profile() {
  const { handle = '' } = useParams()
  return <ProfileScreen key={handle} handle={handleFromParam(handle)} />
}

function Leaderboard() {
  const [q] = useSearchParams()
  const board = q.get('board')
  return <LeaderboardScreen initialBoard={BOARDS.find((b) => b === board) ?? 'overall'} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
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
  </StrictMode>,
)
