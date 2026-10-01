'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Logo } from '@/components/art/Logo'
import { Badge } from '@/components/badges/Badge'
import { Icon } from '@/components/ui/Icon'
import { useApp } from '@/components/world/WorldProvider'
import { SOL_USD } from '@/lib/constants'
import { fmtClock, fmtSol, roman } from '@/lib/format'
import { mainBadge } from '@/lib/selectors'
import { FindMatchDialog } from './FindMatchDialog'
import styles from './TopBar.module.css'

const NAV = [
  { href: '/', label: 'Pulse' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/discover', label: 'Discover' },
  { href: '/badges', label: 'Badges' },
  { href: '/mooners', label: 'Mooners' },
] as const

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

export function TopBar() {
  const pathname = usePathname()
  return (
    <header className={styles.bar}>
      <Link href="/" className={styles.brand}>
        <Logo size={26} />
        Mooner
      </Link>
      <nav aria-label="Main" className={styles.nav}>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={styles.navLink}
            aria-current={isActive(pathname, n.href) ? 'page' : undefined}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <SearchBox />
      <div className={styles.right}>
        <span className={`num ${styles.solPrice}`} title="Mock SOL price">
          SOL ${SOL_USD.toFixed(2)}
        </span>
        <MatchButton />
        <WalletChip />
        <ProfileChip />
      </div>
    </header>
  )
}

/** The pages the search filters in place. */
const SEARCHABLE = ['/', '/discover']

/** Filters Pulse's rails and Discover's list; typing anywhere else takes you to Discover, the list of every coin. */
function SearchBox() {
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const router = useRouter()
  const pathname = usePathname()
  const pushed = useRef(false)

  useEffect(() => {
    pushed.current = false
  }, [pathname])

  return (
    <div className={styles.search} role="search">
      <Icon name="search" size={14} />
      <input
        className={`input ${styles.searchInput}`}
        type="search"
        placeholder="Search name or $TICKER"
        aria-label="Search tokens by name or ticker"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          if (!SEARCHABLE.includes(pathname) && !pushed.current) {
            pushed.current = true
            router.push('/discover')
          }
        }}
      />
    </div>
  )
}

function MatchButton() {
  const tokenId = useApp((s) => s.world.match?.tokenId)
  const elapsed = useApp((s) => (s.world.match ? s.world.now - s.world.match.queuedAt : 0))
  const settling = useApp((s) => {
    const m = s.world.match
    return m ? s.world.tokens[m.tokenId]?.stage === 'launching' : false
  })
  const [open, setOpen] = useState(false)
  const router = useRouter()

  if (tokenId) {
    return (
      <Link href={`/presale/${tokenId}`} className="btn">
        {settling ? (
          'Match found'
        ) : (
          <>
            <span className={styles.long}>Looking for match ·</span>
            <span className={styles.short}>Matching</span>
            <span className="num">{fmtClock(elapsed)}</span>
          </>
        )}
      </Link>
    )
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="rocket" size={14} />
        Launch
      </button>
      <FindMatchDialog
        open={open}
        onClose={() => setOpen(false)}
        onMatched={(id) => {
          setOpen(false)
          router.push(`/presale/${id}`)
        }}
      />
    </>
  )
}

function WalletChip() {
  const wallet = useApp((s) => s.world.walletLamports)
  return (
    <span className={styles.wallet} title="Demo wallet: simulated SOL">
      <Icon name="wallet" size={14} />
      <span className="num">{fmtSol(wallet)}</span>
      <span className={styles.walletUnit}>SOL</span>
      <span className="sr-only"> in your demo wallet</span>
    </span>
  )
}

function ProfileChip() {
  const me = useApp((s) => s.world.users[s.world.meId])
  const signedIn = useApp((s) => s.signedIn)
  const openSignIn = useApp((s) => s.openSignIn)
  const badge = mainBadge(me)
  if (!signedIn) {
    return (
      <button type="button" className="btn" onClick={openSignIn}>
        <Icon name="x" size={14} />
        Sign in
      </button>
    )
  }
  return (
    <Link href={`/profile/${me.handle}`} className={styles.profile} aria-label={`Your profile, @${me.handle}`}>
      <Avatar handle={me.handle} size={26} />
      <Badge title={badge.title} level={badge.level} size={22} label={false} />
      <span className={`num ${styles.level}`} aria-hidden>
        {roman(badge.level)}
      </span>
    </Link>
  )
}
