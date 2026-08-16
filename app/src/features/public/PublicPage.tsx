/**
 * The public share page. SPEC.md §7.5.
 *
 * This is the page a WhatsApp group opens on mobile data, twenty people at
 * once, most of whom will never install anything. It has to load fast, work
 * without an account, and make somebody want to show it to a friend.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/services/client'
import {
  Badge, Button, Card, EmptyState, PlayerAvatar,
  RankBadge, SectionTitle, Skeleton, StatTile,
} from '@/components/ui'
import { CountUp, FadeIn, Stagger, StaggerItem } from '@/components/motion'
import { points, shortDate } from '@/lib/format'
import type { PublicPageData } from '@/types'

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
                        <span className="block truncate text-[15px] text-chalk">
                          {row.player.display_name}
                        </span>
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
                          <span className="text-[13px] text-chalk-muted">
                            {award.player.display_name}
                          </span>
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
                            {m.side_a_score}–{m.side_b_score}
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
        <span className="min-w-0 flex-1 truncate text-[15px] text-chalk">
          {entry.player.display_name}
        </span>
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
  player: { id: string; display_name: string; photo_url: string | null; jersey_number: number | null; position: string | null }
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
      <div className="px-5 pt-5">
        <Link to={`/t/${slug}`} className="text-[14px] text-chalk-muted">
          ← {data.organization.name}
        </Link>
      </div>

      <FadeIn className="pitch-lines px-5 pb-8 pt-6 text-center">
        <PlayerAvatar
          name={data.player.display_name}
          photoUrl={data.player.photo_url}
          size="xl"
          className="mx-auto"
        />
        <h1 className="mt-4 text-3xl">{data.player.display_name}</h1>
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

        {/* Full stat table — every number the season has on this player */}
        {data.stats && (
          <section className="mt-7">
            <SectionTitle>Full stats — {data.period.label}</SectionTitle>
            <Card className="divide-y divide-pitch-700 p-0">
              <StatRow label="Goals" value={data.stats.goals} />
              <StatRow label="Assists" value={data.stats.assists} />
              <StatRow label="Own goals" value={data.stats.own_goals} />
              <StatRow label="Appearances" value={data.stats.appearances} />
              <StatRow label="Clean sheets" value={data.stats.clean_sheets} />
              {data.stats.saves > 0 && <StatRow label="Saves" value={data.stats.saves} />}
              {data.stats.yellow_cards !== undefined && (
                <StatRow label="Yellow cards" value={data.stats.yellow_cards} />
              )}
              {data.stats.red_cards !== undefined && (
                <StatRow label="Red cards" value={data.stats.red_cards} />
              )}
              {data.stats.punctuality_score !== undefined && (
                <StatRow label="Punctuality" value={points(data.stats.punctuality_score)} />
              )}
              <StatRow label="Total points" value={points(data.stats.total_points)} accent />
            </Card>
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
