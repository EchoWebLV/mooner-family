'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useExportWallet } from '@privy-io/react-auth/solana'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Logo } from '@/components/art/Logo'
import { Badge } from '@/components/badges/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { Icon } from '@/components/ui/Icon'
import { useApp } from '@/components/world/WorldProvider'
import { fmtClock, fmtSol, roman, shortAddress } from '@/lib/format'
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
  const solUsd = useApp((s) => s.solUsd)
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
        {/* its own app at /sim, outside this router */}
        <a href="/sim" className={styles.navLink}>
          Simulation
        </a>
      </nav>
      <SearchBox />
      <div className={styles.right}>
        <span className={`num ${styles.solPrice}`} title="SOL price from Jupiter">
          SOL ${solUsd.toFixed(2)}
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

/** Sign in (Privy: a wallet, email or X), or once you're in, your wallet's SOL. Clicking it
 *  opens your wallet: its address to send SOL to, the key of a Privy wallet, and sign out. */
function WalletChip() {
  const lamports = useApp((s) => s.world.walletLamports)
  const wallet = useApp((s) => s.wallet)
  const connect = useApp((s) => s.connectWallet)
  const signOut = useApp((s) => s.signOut)
  const { ready, authenticated, user, logout } = usePrivy()
  const { exportWallet } = useExportWallet()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!ready) {
    return (
      <button type="button" className="btn" disabled>
        <Icon name="wallet" size={14} />
        Sign in
      </button>
    )
  }
  if (!authenticated || !wallet) {
    return (
      <button type="button" className="btn btn-primary" onClick={connect}>
        <Icon name="wallet" size={14} />
        {authenticated ? 'Connect wallet' : 'Sign in'}
      </button>
    )
  }
  const address = wallet.publicKey.toBase58()
  const privyWallet = user?.linkedAccounts.some(
    (a) => a.type === 'wallet' && a.address === address && (a.walletClientType === 'privy' || a.walletClientType === 'privy-v2'),
  )
  const email = user?.email?.address
  const x = user?.twitter?.username
  return (
    <div className={styles.walletBox} ref={box}>
      <button
        type="button"
        className={styles.wallet}
        aria-expanded={open}
        aria-haspopup="menu"
        title={address}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="wallet" size={14} />
        <span className="num">{fmtSol(lamports)}</span>
        <span className={styles.walletUnit}>SOL</span>
        <span className="sr-only"> in {shortAddress(address)}</span>
      </button>
      {open && (
        <div className={styles.walletMenu} role="menu">
          <p className={styles.walletWho}>{x ? `@${x}` : (email ?? (privyWallet ? 'Your Mooner wallet' : 'Your wallet'))}</p>
          <div className={styles.walletAddress}>
            <span className="num">{shortAddress(address)}</span>
            <CopyButton value={address} label="Copy wallet address" />
          </div>
          {privyWallet && <p className={styles.walletHint}>Send SOL to this address to join presales.</p>}
          {privyWallet && (
            <button
              type="button"
              role="menuitem"
              className="btn btn-block btn-sm"
              onClick={() => {
                setOpen(false)
                exportWallet({ address }).catch(() => {})
              }}
            >
              Export private key
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="btn btn-block btn-sm"
            onClick={async () => {
              setOpen(false)
              signOut()
              await logout().catch(() => {})
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function ProfileChip() {
  const me = useApp((s) => s.world.users[s.world.meId])
  const signedIn = useApp((s) => s.signedIn)
  const openSignIn = useApp((s) => s.openSignIn)
  const hasWallet = useApp((s) => !!s.wallet)
  const badge = mainBadge(me)
  // the wallet chip signs you in; this sets up your Mooner once you are
  if (!hasWallet) return null
  if (!signedIn) {
    return (
      <button type="button" className="btn" onClick={openSignIn}>
        <Icon name="moon" size={14} />
        Get your Mooner
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
