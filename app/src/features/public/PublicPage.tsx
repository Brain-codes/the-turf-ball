/**
 * The public share page. SPEC.md §7.5.
 *
 * This is the page a WhatsApp group opens on mobile data, twenty people at
 * once, most of whom will never install anything. It has to load fast, work
 * without an account, and make somebody want to show it to a friend.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/services/client'
import { cn } from '@/lib/cn'
import {
  Badge, Button, Card, EmptyState, PlayerAvatar, PlayerName,
  RankBadge, SectionTitle, Skeleton, StatTile,
} from '@/components/ui'
import { CountUp, FadeIn, Stagger, StaggerItem } from '@/components/motion'
import { PublicNavbar } from '@/components/layout/PublicNavbar'
import { points, shortDate } from '@/lib/format'
import type { PublicPageData, PublicSessionData } from '@/types'

/**
 * "Back" here isn't always the team page — a player might have arrived from
 * the global leaderboard, a WhatsApp link, or the team page itself. Prefer
 * actual browser history when this tab has any (so it returns to wherever
 * the visitor really came from); only fall back to the team page when there
 * is nothing to go back to (a fresh tab, a shared link opened directly).
 */
function useSmartBack(fallback: string) {
  const navigate = useNavigate()
  const location = useLocation()
  const canGoBack = location.key !== 'default'
  return () => (canGoBack ? navigate(-1) : navigate(fallback))
}

const LIVE_EVENT_LABEL: Record<string, string> = {
  goal: 'Goal', own_goal: 'Own goal', assist: 'Assist',
  yellow_card: 'Yellow card', red_card: 'Red card',
}
const LIVE_EVENT_ICON: Record<string, string> = {
  goal: '⚽', own_goal: '🥅', assist: '🎯', yellow_card: '🟨', red_card: '🟥',
}

export function PublicPageScreen() {
  const { slug } = useParams<{ slug: string }>()
  const [periodId, setPeriodId] = useState('')
  const [copied, setCopied] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['public', slug, periodId],
    queryFn: async () =>
      (await api.public<PublicPageData>(`public/${slug}`, { period_id: periodId || undefined })).data,
    enabled: !!slug,
    // The page is often left open during a session, so keep it fresh without
    // asking anyone to pull to refresh.
    refetchInterval: 60_000,
  })

  if (isLoading) return <PublicSkeleton />

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5">
        <EmptyState
          icon="⚽"
          title="Page not found"
          description="This group's page might have been turned off, or the link is wrong."
        />
      </div>
    )
  }

  const potm = data.awards.find((a) => a.type.code === 'player_of_month')
  const leader = data.leaderboard[0]
  const isOpen = data.period.status === 'open'

  async function share() {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: data!.organization.name, url })
        return
      } catch {
        /* Dismissed — fall through to copying. */
      }
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-dvh pb-24">
      <PublicNavbar />
      {/* Hero */}
      <FadeIn>
        <header className="pitch-lines px-5 pb-8 pt-10 text-center">
          {data.organization.logo_url ? (
            <img
              src={data.organization.logo_url}
              alt=""
              className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover"
            />
          ) : (
            <div className="mb-4 text-4xl">⚽</div>
          )}

          <h1 className="text-[clamp(1.75rem,7vw,2.5rem)] leading-tight">
            {data.organization.name}
          </h1>

          {data.organization.venue && (
            <p className="mt-1.5 text-[14px] text-chalk-muted">{data.organization.venue}</p>
          )}

          <div className="mt-4 flex items-center justify-center gap-2">
            {data.periods.length > 1 ? (
              <select
                value={periodId || data.period.id}
                onChange={(e) => setPeriodId(e.target.value)}
                className="rounded-full border border-pitch-700 bg-pitch-900 px-3.5 py-1.5 text-[13px] text-chalk focus:outline-none"
              >
                {data.periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            ) : (
              <span className="text-[13px] uppercase tracking-wider text-chalk-muted">
                {data.period.label}
              </span>
            )}
            {!isOpen && <Badge>Final</Badge>}
          </div>
        </header>
      </FadeIn>

      <div className="mx-auto max-w-2xl px-5">
        {data.live_session && (
          <Link
            to={`/t/${slug}/live/${data.live_session.id}`}
            className="mb-5 flex items-center gap-2.5 rounded-xl border border-card-red/40 bg-card-red/10 px-4 py-3 transition-colors active:bg-card-red/15"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-card-red opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-card-red" />
            </span>
            <span className="min-w-0 flex-1 text-[14px] font-medium text-chalk">
              {data.live_session.title || 'A session'} is live right now
            </span>
            <span className="shrink-0 text-[13px] text-card-red">Watch →</span>
          </Link>
        )}

        {/* Totals */}
        <div className="mb-7 grid grid-cols-4 gap-2.5">
          <StatTile label="Players" value={data.totals.players} />
          <StatTile label="Sessions" value={data.totals.sessions} />
          <StatTile label="Goals" value={<CountUp value={data.totals.goals} />} accent />
          <StatTile label="Assists" value={data.totals.assists} />
        </div>

        {data.leaderboard.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No games played yet"
            description={`Nothing recorded for ${data.period.label} so far.`}
          />
        ) : (
          <>
            {/* The headline card: the winner if the month is done, otherwise
                whoever is currently on top. Either way, somebody's name is big. */}
            <FadeIn>
              <div className="surface-raised relative mb-7 overflow-hidden p-6 text-center">
                <div
                  className="absolute inset-0 opacity-[0.09]"
                  style={{ background: 'radial-gradient(circle at 50% 0%, var(--color-volt-400), transparent 70%)' }}
                />
                <div className="relative">
                  <div className="text-4xl">🏆</div>
                  <p className="mt-2.5 text-[11.5px] uppercase tracking-[0.2em] text-volt-400">
                    {potm ? 'Player of the Month' : 'Currently leading'}
                  </p>

                  <PlayerAvatar
                    name={(potm?.player ?? leader.player).display_name}
                    photoUrl={(potm?.player ?? leader.player).photo_url}
                    size="xl"
                    className="mx-auto mt-5"
                  />

                  <h2 className="mt-4 text-3xl">
                    {(potm?.player ?? leader.player).display_name}
                  </h2>
                  {(potm?.player ?? leader.player).whatsapp_nickname &&
                    (potm?.player ?? leader.player).whatsapp_nickname!.trim() !==
                      (potm?.player ?? leader.player).display_name.trim() && (
                      <p className="mt-0.5 text-[12px] text-chalk-faint/70">
                        {(potm?.player ?? leader.player).whatsapp_nickname}
                      </p>
                    )}

                  <div className="mt-5 flex justify-center gap-8">
                    <HeroStat label="Goals" value={leader.goals} />
                    <HeroStat label="Assists" value={leader.assists} />
                    <HeroStat label="Apps" value={leader.appearances} />
                  </div>

                  <div className="numeric mt-5 text-5xl text-volt-400">
                    {points(potm?.value ?? leader.total_points)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-chalk-muted">points</div>
                </div>
              </div>
            </FadeIn>

            {/* Leaderboard */}
            <section className="mb-7">
              <SectionTitle>The table</SectionTitle>
              <Stagger className="surface divide-y divide-pitch-700 overflow-hidden">
                {data.leaderboard.map((row) => (
                  <StaggerItem key={row.player.id}>
                    <Link
                      to={`/t/${slug}/player/${row.player.id}`}
                      className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-pitch-800"
                    >
                      <RankBadge rank={row.rank} />
                      <PlayerAvatar
                        name={row.player.display_name}
                        photoUrl={row.player.photo_url}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <PlayerName
                          name={row.player.display_name}
                          whatsappNickname={row.player.whatsapp_nickname}
                          className="block text-[15px] text-chalk"
                        />
                        <span className="text-[12.5px] text-chalk-muted">
                          {row.goals}G · {row.assists}A · {row.appearances} apps
                        </span>
                      </span>
                      <span className="numeric text-xl text-volt-400">
                        {points(row.total_points)}
                      </span>
                    </Link>
                  </StaggerItem>
                ))}
              </Stagger>
            </section>

            {/* Top performers */}
            <section className="mb-7">
              <SectionTitle>Leading the way</SectionTitle>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <TopCard icon="⚽" label="Top scorer" entry={data.top_scorer} />
                <TopCard icon="🎯" label="Most assists" entry={data.top_assister} />
                <TopCard icon="🧤" label="Clean sheets" entry={data.top_keeper} />
              </div>
            </section>

            {/* Other awards */}
            {data.awards.filter((a) => a.type.code !== 'player_of_month').length > 0 && (
              <section className="mb-7">
                <SectionTitle>Awards</SectionTitle>
                <div className="space-y-2">
                  {data.awards
                    .filter((a) => a.type.code !== 'player_of_month')
                    .map((award) => (
                      <Card key={award.type.code} className="flex items-center gap-3">
                        <span className="text-xl">{award.type.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] text-chalk">{award.type.name}</span>
                          <PlayerName
                            name={award.player.display_name}
                            whatsappNickname={award.player.whatsapp_nickname}
                            className="text-[13px] text-chalk-muted"
                          />
                        </span>
                        <span className="numeric text-lg text-volt-400">{points(award.value)}</span>
                      </Card>
                    ))}
                </div>
              </section>
            )}

            {/* Results */}
            {data.sessions.length > 0 && (
              <section>
                <SectionTitle>Recent sessions</SectionTitle>
                <div className="space-y-2">
                  {data.sessions.map((session) => (
                    <Card key={session.id} className="flex items-center gap-3">
                      <span className="flex-1 text-[14.5px] text-chalk">
                        {session.title || shortDate(session.session_date)}
                      </span>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {(session.matches ?? []).map((m, i) => (
                          <span
                            key={i}
                            className="numeric rounded-lg bg-pitch-800 px-2 py-1 text-[13px] text-chalk-muted"
                          >
                            {m.side_a_score} goals
                          </span>
                        ))}
                      </span>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <p className="mt-10 text-center text-[12.5px] text-chalk-faint">
          Powered by <span className="text-chalk-muted">The Turf Ball</span>
        </p>
      </div>

      {/* Sticky share */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-pitch-700 bg-pitch-900/95 px-5 py-3 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-2xl">
          <Button fullWidth onClick={share}>
            {copied ? 'Link copied ✓' : 'Share this page'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="numeric text-2xl text-chalk">{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider text-chalk-muted">{label}</div>
    </div>
  )
}

function TopCard({
  icon,
  label,
  entry,
}: {
  icon: string
  label: string
  entry: PublicPageData['top_scorer']
}) {
  if (!entry) {
    return (
      <Card className="opacity-50">
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">{label}</div>
        <div className="mt-2 text-[14px] text-chalk-faint">Nobody yet</div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="text-[11px] uppercase tracking-wider text-chalk-muted">
        {icon} {label}
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <PlayerAvatar name={entry.player.display_name} photoUrl={entry.player.photo_url} size="sm" />
        <PlayerName
          name={entry.player.display_name}
          whatsappNickname={entry.player.whatsapp_nickname}
          className="flex-1 text-[15px] text-chalk"
        />
        <span className="numeric text-2xl text-volt-400">{entry.value}</span>
      </div>
    </Card>
  )
}

function PublicSkeleton() {
  return (
    <div className="px-5 pt-10">
      <Skeleton className="mx-auto h-16 w-16 rounded-2xl" />
      <Skeleton className="mx-auto mt-4 h-9 w-56" />
      <div className="mx-auto mt-8 grid max-w-2xl grid-cols-4 gap-2.5">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="mx-auto mt-7 h-72 max-w-2xl" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* A single player's shareable card                                            */
/* -------------------------------------------------------------------------- */

interface PlayerStatLine {
  goals: number
  assists: number
  own_goals: number
  appearances: number
  clean_sheets: number
  saves: number
  yellow_cards?: number
  red_cards?: number
  punctuality_score?: number
  total_points: number
  rank?: number
}

interface PublicPlayerData {
  organization: { name: string; slug: string; logo_url: string | null }
  period: { label: string }
  player: {
    id: string
    display_name: string
    whatsapp_nickname?: string | null
    photo_url: string | null
    jersey_number: number | null
    position: string | null
  }
  stats: PlayerStatLine | null
  awards: { value: number; award_types: { name: string; icon: string }; periods: { label: string } }[]
  history: (PlayerStatLine & { periods: { label: string } })[]
  match_log: {
    session: { id: string; session_date: string; title: string | null } | null
    goals: number
    assists: number
    own_goals: number
    yellow_cards?: number
    red_cards?: number
  }[]
}

export function PublicPlayerScreen() {
  const { slug, playerId } = useParams<{ slug: string; playerId: string }>()
  const goBack = useSmartBack(`/t/${slug}`)

  const { data, isLoading } = useQuery({
    queryKey: ['public-player', slug, playerId],
    queryFn: async () =>
      (await api.public<PublicPlayerData>(`public/${slug}/player/${playerId}`)).data,
    enabled: !!slug && !!playerId,
  })

  if (isLoading) {
    return (
      <div className="px-5 pt-10">
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-8 w-44" />
      </div>
    )
  }

  if (!data) return <EmptyState icon="⚽" title="Player not found" />

  return (
    <div className="min-h-dvh pb-10">
      <PublicNavbar />
      <div className="px-5 pt-5">
        <button onClick={goBack} className="text-[14px] text-chalk-muted">
          ← {data.organization.name}
        </button>
      </div>

      <FadeIn className="pitch-lines px-5 pb-8 pt-6 text-center">
        <PlayerAvatar
          name={data.player.display_name}
          photoUrl={data.player.photo_url}
          size="xl"
          className="mx-auto"
        />
        <h1 className="mt-4 text-3xl">{data.player.display_name}</h1>
        {data.player.whatsapp_nickname && data.player.whatsapp_nickname.trim() !== data.player.display_name.trim() && (
          <p className="mt-0.5 text-[12px] text-chalk-faint/70">{data.player.whatsapp_nickname}</p>
        )}
        <p className="mt-1 text-[13px] uppercase tracking-wider text-chalk-muted">
          {data.period.label}
        </p>
        {data.stats && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-volt-400/10 px-4 py-1.5">
            <span className="numeric text-lg text-volt-400">#{data.stats.rank}</span>
            <span className="text-[13px] text-chalk-muted">in the table</span>
          </div>
        )}
      </FadeIn>

      <div className="mx-auto max-w-lg px-5">
        {data.stats ? (
          <div className="grid grid-cols-4 gap-2.5">
            <StatTile label="Goals" value={data.stats.goals} accent />
            <StatTile label="Assists" value={data.stats.assists} />
            <StatTile label="Apps" value={data.stats.appearances} />
            <StatTile label="Points" value={points(data.stats.total_points)} />
          </div>
        ) : (
          <Card>
            <p className="py-2 text-center text-[14px] text-chalk-muted">
              No games played this month.
            </p>
          </Card>
        )}

        {/* Full stats, grouped by category — a stats-centre layout rather than
            one long flat list, so a glance tells you what kind of player
            this is (attack vs. defence vs. discipline). */}
        {data.stats && (
          <section className="mt-7">
            <SectionTitle>Full stats — {data.period.label}</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatGroup title="Attack">
                <StatRow label="Goals" value={data.stats.goals} />
                <StatRow label="Assists" value={data.stats.assists} />
                <StatRow label="Own goals" value={data.stats.own_goals} />
              </StatGroup>

              <StatGroup title="Playing time">
                <StatRow label="Appearances" value={data.stats.appearances} />
                <StatRow label="Clean sheets" value={data.stats.clean_sheets} />
                {data.stats.saves > 0 && <StatRow label="Saves" value={data.stats.saves} />}
              </StatGroup>

              {(data.stats.yellow_cards !== undefined || data.stats.red_cards !== undefined) && (
                <StatGroup title="Discipline">
                  {data.stats.yellow_cards !== undefined && (
                    <StatRow label="Yellow cards" value={data.stats.yellow_cards} />
                  )}
                  {data.stats.red_cards !== undefined && (
                    <StatRow label="Red cards" value={data.stats.red_cards} />
                  )}
                </StatGroup>
              )}

              <StatGroup title="Overall">
                {data.stats.punctuality_score !== undefined && (
                  <StatRow label="Punctuality" value={points(data.stats.punctuality_score)} />
                )}
                <StatRow label="Total points" value={points(data.stats.total_points)} accent />
              </StatGroup>
            </div>
          </section>
        )}

        {data.awards.length > 0 && (
          <section className="mt-7">
            <SectionTitle>Awards</SectionTitle>
            <div className="space-y-2">
              {data.awards.map((award, i) => (
                <Card key={i} className="flex items-center gap-3">
                  <span className="text-xl">{award.award_types.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] text-chalk">{award.award_types.name}</span>
                    <span className="text-[13px] text-chalk-muted">{award.periods?.label}</span>
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Match history — every game logged, not just monthly rollups */}
        {data.match_log.length > 0 && (
          <section className="mt-7">
            <SectionTitle>Match history</SectionTitle>
            <Card className="divide-y divide-pitch-700 p-0">
              {data.match_log.map((row, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-chalk">
                      {row.session?.title || shortDate(row.session?.session_date ?? '')}
                    </span>
                    {row.session?.title && (
                      <span className="block text-[12px] text-chalk-faint">
                        {shortDate(row.session.session_date)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-chalk-muted">
                    {row.goals > 0 && <span>⚽ {row.goals}</span>}
                    {row.assists > 0 && <span>🅰️ {row.assists}</span>}
                    {row.own_goals > 0 && <span>🥅 {row.own_goals}</span>}
                    {!!row.yellow_cards && <span>🟨 {row.yellow_cards}</span>}
                    {!!row.red_cards && <span>🟥 {row.red_cards}</span>}
                    {row.goals === 0 && row.assists === 0 && row.own_goals === 0 && !row.yellow_cards && !row.red_cards && (
                      <span className="text-chalk-faint">Played</span>
                    )}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}

        {data.history.length > 1 && (
          <section className="mt-7">
            <SectionTitle>Month by month</SectionTitle>
            <Card className="divide-y divide-pitch-700 p-0">
              {data.history.map((row, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="flex-1 text-[14px] text-chalk-muted">{row.periods?.label}</span>
                  <span className="text-[13px] text-chalk-muted">
                    {row.goals}G · {row.assists}A
                    {row.own_goals > 0 && ` · ${row.own_goals}OG`}
                  </span>
                  <span className="numeric w-12 text-right text-[15px] text-chalk">
                    {points(row.total_points)}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}
      </div>
    </div>
  )
}

function StatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="border-b border-pitch-700 px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-chalk-muted">
        {title}
      </div>
      <div className="divide-y divide-pitch-700">{children}</div>
    </Card>
  )
}

function StatRow({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <span className="text-[14px] text-chalk-muted">{label}</span>
      <span className={`numeric text-[15px] font-semibold ${accent ? 'text-volt-400' : 'text-chalk'}`}>
        {value}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* View-only live tracker — no login, no interaction. A guest watches what's  */
/* happening as it happens; nothing here can change anything.                 */
/* -------------------------------------------------------------------------- */

interface LivePlayerStatRow {
  playerId: string
  name: string
  whatsappNickname: string | null
  goals: number
  assists: number
  ownGoals: number
  yellowCards: number
  redCards: number
}

interface Dot { x: number; y: number; team: 'a' | 'b' }

/** Fisher-Yates — used both for shuffling the candidate slots and picking a random next hop. */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * A pool of pitch coordinates wider than the 22 dots actually shown, with a
 * little jitter — so which 22 get used, and which team each lands on, comes
 * out differently every time this mounts. "Formations" that look mixed and
 * non-repeating rather than a fixed, memorizable shape.
 */
function randomFormation(): Dot[] {
  const rows = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 94]
  const cols = [15, 30, 42, 50, 58, 70, 85]
  const pool: { x: number; y: number }[] = []
  for (const y of rows) {
    for (const x of cols) {
      pool.push({ x: x + (Math.random() * 8 - 4), y: y + (Math.random() * 4 - 2) })
    }
  }
  const picked = shuffled(pool).slice(0, 22)
  const teams = shuffled([
    ...Array(11).fill('a'), ...Array(11).fill('b'),
  ]) as ('a' | 'b')[]
  return picked.map((p, i) => ({ ...p, team: teams[i] }))
}

/**
 * A fresh set of 22 positions for the SAME 22 dots (same array order, same
 * team per slot) — used to slide the formation to a new shape without any
 * dot changing identity or color, so the CSS position transition on each
 * dot reads as "players moving around", never a swap or a pop.
 */
function reformation(prev: Dot[]): Dot[] {
  const rows = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 94]
  const cols = [15, 30, 42, 50, 58, 70, 85]
  const pool: { x: number; y: number }[] = []
  for (const y of rows) {
    for (const x of cols) {
      pool.push({ x: x + (Math.random() * 8 - 4), y: y + (Math.random() * 4 - 2) })
    }
  }
  const picked = shuffled(pool).slice(0, prev.length)
  return prev.map((d, i) => ({ ...picked[i], team: d.team }))
}

/**
 * Hops the ball between random dots, one at a time — never the same one
 * twice in a row — at a randomized speed each hop (bounded so it never
 * feels frantic or sluggish). Height (scale) peaks at the midpoint of each
 * hop and eases back down at the landing, driven by a plain timer loop
 * rather than CSS keyframes so both the target and the duration can be
 * re-rolled every single hop. Reads positions through a ref so a formation
 * change mid-hop doesn't restart or snap the ball.
 */
function useBouncingBall(points: Dot[], paused: boolean) {
  const [ball, setBall] = useState(() => ({ x: points[0]?.x ?? 50, y: points[0]?.y ?? 50, scale: 1 }))
  const pointsRef = useRef(points)
  const reduceMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    pointsRef.current = points
  }, [points])

  useEffect(() => {
    if (paused || reduceMotion.current || points.length < 2) return

    let cancelled = false
    let fromIdx = Math.floor(Math.random() * pointsRef.current.length)
    let toIdx = (fromIdx + 1 + Math.floor(Math.random() * (pointsRef.current.length - 1))) % pointsRef.current.length
    let start = Date.now()
    // Randomized per hop: not too fast, not too slow.
    let duration = 900 + Math.random() * 1400

    const tick = () => {
      if (cancelled) return
      const pts = pointsRef.current
      const t = Math.min(1, (Date.now() - start) / duration)
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      const from = pts[fromIdx]
      const to = pts[toIdx]
      const x = from.x + (to.x - from.x) * ease
      const y = from.y + (to.y - from.y) * ease
      const scale = 1 + 0.65 * Math.sin(t * Math.PI)
      setBall({ x, y, scale })

      if (t >= 1) {
        fromIdx = toIdx
        let next = Math.floor(Math.random() * pts.length)
        if (next === fromIdx) next = (next + 1) % pts.length
        toIdx = next
        duration = 900 + Math.random() * 1400
        start = Date.now()
      }
      window.setTimeout(tick, 40)
    }
    const id = window.setTimeout(tick, 40)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // Only (re)start the loop on pause/resume — points update via the ref
    // effect above, not by restarting this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  return ball
}

/**
 * A full tilted pitch with a randomized formation of dots (two "teams"),
 * and a ball hopping between them at a randomized pace and in a randomized
 * order — different every time, never a fixed pattern, just enough motion
 * to read as "this is happening right now." Every 13-20s the formation
 * itself drifts to new spots too — same dots, same colors, just walking
 * there via a CSS position transition rather than popping. Collapsible — a
 * guest who finds it distracting can hide it.
 */
function LivePitchAnimation() {
  const [collapsed, setCollapsed] = useState(false)
  const [dots, setDots] = useState(randomFormation)
  const ball = useBouncingBall(dots, collapsed)

  // Every so often, the whole formation drifts to new spots — same 22
  // dots, same colors, just new coordinates, picked up by the CSS
  // transition on each dot so they visibly walk there rather than jump.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (collapsed || reduceMotion) return
    const id = window.setTimeout(
      () => setDots((prev) => reformation(prev)),
      13_000 + Math.random() * 7_000,
    )
    return () => window.clearTimeout(id)
  }, [dots, collapsed])

  return (
    <div className="live-pitch-wrap mx-auto mt-4 w-full max-w-[280px]">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="mb-1.5 w-full flex items-center justify-center gap-1 text-[11px] text-chalk-faint text-center underline decoration-chalk-faint/40"
      >
        {collapsed ? 'Show pitch' : 'Hide pitch'}
      </button>

      {!collapsed && (
        <div className="live-pitch relative aspect-[3/4.2] overflow-hidden rounded-xl border border-pitch-700 bg-gradient-to-b from-emerald-800/70 via-emerald-900/70 to-emerald-950/70">
          {/* Markings */}
          <div className="absolute inset-3 border border-chalk/25" />
          <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-chalk/25" />
          <div className="absolute left-1/2 top-1/2 h-0.5 w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 bg-chalk/25" />
          <div className="absolute left-1/2 top-3 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-chalk/25" />
          <div className="absolute left-1/2 bottom-3 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-chalk/25" />
          <div className="absolute left-1/2 top-3 h-[16%] w-[46%] -translate-x-1/2 border border-t-0 border-chalk/25" />
          <div className="absolute left-1/2 bottom-3 h-[16%] w-[46%] -translate-x-1/2 border border-b-0 border-chalk/25" />

          {/* Players — position transition is what makes a formation change
              read as walking there, not popping there. */}
          {dots.map((d, i) => (
            <span
              key={i}
              className={cn(
                'absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-void/30 transition-[left,top] duration-[2200ms] ease-in-out',
                d.team === 'a' ? 'bg-chalk/90' : 'bg-volt-400/90',
              )}
              style={{ left: `${d.x}%`, top: `${d.y}%` }}
            />
          ))}

          {/* Ball's shadow — squashes and fades as the ball "lifts" mid-hop */}
          <div
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-void/50 blur-[1px] transition-none"
            style={{
              left: `${ball.x}%`,
              top: `${ball.y}%`,
              transform: `translate(-50%, -50%) scale(${1 / ball.scale})`,
              opacity: 0.55 / ball.scale,
            }}
          />
          {/* The ball */}
          <div
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chalk shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-none"
            style={{
              left: `${ball.x}%`,
              top: `${ball.y}%`,
              transform: `translate(-50%, -50%) scale(${ball.scale})`,
            }}
          />

          <style>{`.live-pitch { transform: perspective(700px) rotateX(22deg); transform-style: preserve-3d; }`}</style>
        </div>
      )}
    </div>
  )
}

/** Ticks every second off a fixed start time — the same shape as the organizer's own match clock. */
function useLiveClock(startedAt: string | null | undefined, running: boolean) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running || !startedAt) return
    const started = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, running])
  return elapsed
}

export function PublicLiveSessionScreen() {
  const { slug, sessionId } = useParams<{ slug: string; sessionId: string }>()
  const goBack = useSmartBack(`/t/${slug}`)

  const { data, isLoading } = useQuery({
    queryKey: ['public-live-session', slug, sessionId],
    queryFn: async () =>
      (await api.public<PublicSessionData>(`public/${slug}/session/${sessionId}`)).data,
    enabled: !!slug && !!sessionId,
    // Fast enough to feel live for a guest watching along, gentle enough not
    // to hammer the function while twenty people have the tab open.
    refetchInterval: 8_000,
  })

  const currentMatch = data?.matches[data.matches.length - 1]
  const isLive = data?.session.status === 'live'
  const elapsed = useLiveClock(currentMatch?.started_at, !!isLive)

  if (isLoading) return <PublicSkeleton />
  if (!data) return <EmptyState icon="⚽" title="Session not found" />

  const totalGoals = data.matches.reduce((sum, m) => sum + m.side_a_score, 0)
  const totalOwnGoals = data.matches.reduce((sum, m) => sum + m.side_b_score, 0)
  const totalYellows = data.events.filter((e) => e.event_type === 'yellow_card').length
  const totalReds = data.events.filter((e) => e.event_type === 'red_card').length
  const activity = [...data.events].reverse()
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  const statRows = data.events.reduce<LivePlayerStatRow[]>((rows, e) => {
    if (!e.players) return rows
    let row = rows.find((r) => r.playerId === e.players!.id)
    if (!row) {
      row = {
        playerId: e.players.id,
        name: e.players.display_name,
        whatsappNickname: e.players.whatsapp_nickname ?? null,
        goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0,
      }
      rows.push(row)
    }
    if (e.event_type === 'goal') row.goals++
    else if (e.event_type === 'assist') row.assists++
    else if (e.event_type === 'own_goal') row.ownGoals++
    else if (e.event_type === 'yellow_card') row.yellowCards++
    else if (e.event_type === 'red_card') row.redCards++
    return rows
  }, []).sort((a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists))

  const topScorer = [...statRows].sort((a, b) => b.goals - a.goals)[0]
  const topAssister = [...statRows].sort((a, b) => b.assists - a.assists)[0]

  return (
    <div className="min-h-dvh pb-10">
      <PublicNavbar />
      <div className="px-5 pt-5">
        <button onClick={goBack} className="text-[14px] text-chalk-muted">
          ← {data.organization.name}
        </button>
      </div>

      <FadeIn className="px-5 pb-6 pt-6 text-center">
        {isLive ? (
          <>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-card-red/10 px-3 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-card-red opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-card-red" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-card-red">Live</span>
            </div>
            {currentMatch?.started_at && (
              <div className="numeric text-lg text-chalk-muted">{clock}</div>
            )}
            <LivePitchAnimation />
          </>
        ) : (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-chalk-faint">
            Session ended
          </p>
        )}
        <h1 className="mt-4 text-2xl text-chalk">{data.session.title || 'Match day'}</h1>
        {data.session.venue && <p className="mt-1 text-[13px] text-chalk-muted">{data.session.venue}</p>}

        <div className="mt-5 flex flex-wrap justify-center gap-6">
          <div>
            <div className="numeric text-4xl text-volt-400">{totalGoals}</div>
            <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-chalk-muted">Goals</div>
          </div>
          {totalOwnGoals > 0 && (
            <div>
              <div className="numeric text-4xl text-chalk">{totalOwnGoals}</div>
              <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-chalk-muted">Own goals</div>
            </div>
          )}
          {(totalYellows > 0 || totalReds > 0) && (
            <div className="flex items-end gap-3">
              {totalYellows > 0 && (
                <div>
                  <div className="numeric text-4xl text-card-yellow">{totalYellows}</div>
                  <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-chalk-muted">🟨 Yellow</div>
                </div>
              )}
              {totalReds > 0 && (
                <div>
                  <div className="numeric text-4xl text-card-red">{totalReds}</div>
                  <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-chalk-muted">🟥 Red</div>
                </div>
              )}
            </div>
          )}
        </div>
      </FadeIn>

      <div className="mx-auto max-w-lg px-5">
        {(topScorer?.goals || topAssister?.assists) && (
          <section className="mb-7">
            <SectionTitle>Leading the way</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              {topScorer && topScorer.goals > 0 && (
                <Card>
                  <div className="text-[11px] uppercase tracking-wider text-chalk-muted">⚽ Top scorer</div>
                  <PlayerName
                    name={topScorer.name}
                    whatsappNickname={topScorer.whatsappNickname}
                    className="mt-1.5 block text-[14.5px] text-chalk"
                  />
                  <div className="numeric mt-1 text-xl text-volt-400">{topScorer.goals}</div>
                </Card>
              )}
              {topAssister && topAssister.assists > 0 && (
                <Card>
                  <div className="text-[11px] uppercase tracking-wider text-chalk-muted">🎯 Top assist</div>
                  <PlayerName
                    name={topAssister.name}
                    whatsappNickname={topAssister.whatsappNickname}
                    className="mt-1.5 block text-[14.5px] text-chalk"
                  />
                  <div className="numeric mt-1 text-xl text-volt-400">{topAssister.assists}</div>
                </Card>
              )}
            </div>
          </section>
        )}

        {statRows.length > 0 && (
          <section className="mb-7">
            <SectionTitle>Stat board</SectionTitle>
            <div className="space-y-2">
              {statRows.map((r, i) => (
                <Card key={r.playerId} className="flex items-center gap-3">
                  <RankBadge rank={i + 1} />
                  <PlayerName
                    name={r.name}
                    whatsappNickname={r.whatsappNickname}
                    className="flex-1 text-[14.5px] font-medium text-chalk"
                  />
                  <div className="flex shrink-0 items-center gap-2.5 text-[12.5px]">
                    {r.goals > 0 && (
                      <span className="text-chalk-muted">⚽ <span className="numeric font-semibold text-volt-400">{r.goals}</span></span>
                    )}
                    {r.assists > 0 && (
                      <span className="text-chalk-muted">🎯 <span className="numeric font-semibold text-chalk">{r.assists}</span></span>
                    )}
                    {r.ownGoals > 0 && (
                      <span className="text-chalk-muted">🥅 <span className="numeric font-semibold text-card-red">{r.ownGoals}</span></span>
                    )}
                    {r.yellowCards > 0 && (
                      <span className="text-chalk-muted">🟨 <span className="numeric font-semibold text-card-yellow">{r.yellowCards}</span></span>
                    )}
                    {r.redCards > 0 && (
                      <span className="text-chalk-muted">🟥 <span className="numeric font-semibold text-card-red">{r.redCards}</span></span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle>Activity</SectionTitle>
          {activity.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-chalk-faint">Nothing recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {activity.map((e, i) => (
                <Card key={i} className="flex items-center gap-3">
                  <span className="text-lg">{LIVE_EVENT_ICON[e.event_type] ?? '•'}</span>
                  <span className="min-w-0 flex-1 text-[14px] text-chalk">
                    {e.players ? (
                      slug && e.players.id ? (
                        <Link to={`/t/${slug}/player/${e.players.id}`} className="font-medium underline decoration-chalk-faint/40">
                          {e.players.display_name}
                        </Link>
                      ) : (
                        <span className="font-medium">{e.players.display_name}</span>
                      )
                    ) : (
                      <span className="font-medium">Unknown</span>
                    )}
                    {e.players?.whatsapp_nickname && e.players.whatsapp_nickname.trim() !== e.players.display_name.trim() && (
                      <span className="ml-1 text-[11px] font-normal text-chalk-faint/70">({e.players.whatsapp_nickname})</span>
                    )}
                    <span className="text-chalk-muted"> — {LIVE_EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                  </span>
                  {e.minute !== null && (
                    <span className="numeric shrink-0 text-[12px] text-chalk-faint">{e.minute}'</span>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-[12px] text-chalk-faint">
          Following along as a guest — view only.
        </p>
      </div>
    </div>
  )
}
