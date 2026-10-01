'use client'
// A player's profile (spec §5.8): who they are, their four titles, the badges they've earned and the presales they've
// been in. Your own profile adds your Mooner's editor and the demo controls.
import Link from 'next/link'
import { useMemo } from 'react'
import { MoonerPic } from '@/components/art/MoonerPic'
import { Badge, badgeName } from '@/components/badges/Badge'
import { TraitList } from '@/components/pfp/TraitList'
import { Icon } from '@/components/ui/Icon'
import { NotFound } from '@/components/ui/NotFound'
import { Stat } from '@/components/ui/Stat'
import { useApp } from '@/components/world/WorldProvider'
import { fmtNumber, fmtPct } from '@/lib/format'
import { BOARDS, boardXp, migratedPct, presalesJoined, rankMap, type Board } from '@/lib/leaderboard'
import { mainTitle, TITLES } from '@/lib/levels'
import { userByHandle } from '@/lib/selectors'
import type { User, World } from '@/lib/types'
import { BadgeCabinet } from './BadgeCabinet'
import { DemoControls } from './DemoControls'
import { LaunchHistory } from './LaunchHistory'
import { MoonerEditor } from './MoonerEditor'
import styles from './Profile.module.css'
import { TitleCard } from './TitleCard'

export function ProfileScreen({ handle }: { handle: string }) {
  const world = useApp((s) => s.world)
  const u = userByHandle(world, handle)
  if (!u) {
    return (
      <NotFound
        what="Player"
        hint={`Nobody here goes by @${handle}. Check the spelling, or find them on the leaderboard.`}
        back={{ href: '/leaderboard', label: 'Open the leaderboard' }}
      />
    )
  }
  return <Profile u={u} world={world} />
}

function Profile({ u, world }: { u: User; world: World }) {
  const users = world.users
  const ranks = useMemo(() => {
    const list = Object.values(users)
    return Object.fromEntries(BOARDS.map((b) => [b, rankMap(list, b)])) as Record<Board, Map<string, number>>
  }, [users])
  const me = u.id === world.meId

  return (
    <div className={`page ${styles.screen}`}>
      <ProfileHeader u={u} me={me} rank={ranks.overall.get(u.id)} players={ranks.overall.size} />

      {me && <MoonerEditor />}

      <section className={styles.titles} aria-labelledby="profile-titles">
        <h2 id="profile-titles" className="sr-only">
          Titles
        </h2>
        {TITLES.map((title) => (
          <TitleCard key={title} u={u} title={title} rank={ranks[title].get(u.id)} />
        ))}
      </section>

      {me && <DemoControls />}

      <div className={styles.lower}>
        <BadgeCabinet u={u} />
        <LaunchHistory u={u} world={world} me={me} />
      </div>
    </div>
  )
}

interface ProfileHeaderProps {
  u: User
  me: boolean
  rank?: number
  players: number
}

function ProfileHeader({ u, me, rank, players }: ProfileHeaderProps) {
  const main = mainTitle(u.titles)
  const level = u.titles[main].level
  const migrated = migratedPct(u)
  return (
    <header className={`panel ${styles.header}`}>
      <div className={styles.portrait}>
        <MoonerPic pfp={u.pfp} size={88} priority={5} label={`@${u.handle}'s Mooner`} />
        <Badge title={main} level={level} size={30} label={false} className={styles.portraitBadge} />
      </div>
      <div className={styles.identity}>
        <h1 className={styles.handle}>
          <span className={styles.handleText}>@{u.handle}</span>
          {me && <span className={styles.you}>You</span>}
        </h1>
        <p className={styles.facts}>
          <span className={styles.fact}>
            <Icon name="x" size={12} />
            Connected to X
          </span>
          <span className={styles.fact}>
            <span className="faint">Main title</span> {badgeName(main, level)}
          </span>
        </p>
        {!me && <TraitList pfp={u.pfp} />}
      </div>
      <dl className={styles.stats}>
        <Stat label="Overall rank">
          <Link href="/leaderboard" className={styles.rankLink}>
            #{rank ?? '—'}
          </Link>{' '}
          <span className={styles.of}>of {players}</span>
        </Stat>
        <Stat label="Total XP">{fmtNumber(boardXp(u, 'overall'), 0)}</Stat>
        <Stat label="Presales joined">{presalesJoined(u)}</Stat>
        <Stat label="Migrated">{migrated === null ? '—' : fmtPct(migrated, 0)}</Stat>
      </dl>
    </header>
  )
}
