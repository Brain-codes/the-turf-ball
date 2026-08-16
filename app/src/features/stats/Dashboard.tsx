import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  Badge, Button, Card, EmptyState, ErrorState, PlayerAvatar,
  RankBadge, SectionTitle, Skeleton, StatTile,
} from '@/components/ui'
import { CountUp, FadeIn, Stagger, StaggerItem } from '@/components/motion'
import { points, shortDate } from '@/lib/format'
import type { DashboardData } from '@/types'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function Dashboard() {
  const { activeOrg, profile } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', activeOrg?.id],
    queryFn: async () => (await api.get<DashboardData>('stats/dashboard')).data,
    enabled: !!activeOrg,
  })

  if (isLoading) return <DashboardSkeleton />
  if (error) return <ErrorState message={(error as Error).message} onRetry={refetch} />
  if (!data) return null

  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const hasPlayed = data.totals.sessions > 0

  return (
    <div className="px-5 pb-8">
      {/* Hero */}
      <FadeIn>
        <div className="pitch-lines -mx-5 mb-6 px-5 pb-7 pt-8">
          <p className="text-[14px] text-chalk-muted">
            {greeting()}{firstName && `, ${firstName}`}
          </p>
          <h1 className="mt-0.5 text-[26px] leading-tight">{activeOrg?.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[13px] uppercase tracking-wider text-chalk-muted">
              {data.period.label}
            </span>
            {data.period.status === 'closed' && <Badge>Closed</Badge>}
          </div>

          <div className="mt-6 flex items-end gap-3">
            <span className="numeric text-[64px] leading-none text-volt-400">
              <CountUp value={data.totals.goals} />
            </span>
            <span className="pb-2.5 text-[13px] uppercase tracking-wider text-chalk-muted">
              goals<br />this month
            </span>
          </div>
        </div>
      </FadeIn>

      {/* Live session takes over the top of the screen — if a game is on, that
          is the only thing the organizer wants to reach. */}
      {data.live_session && (
        <FadeIn>
          <button
            onClick={() => navigate(`/app/sessions/${data.live_session!.id}/live`)}
            className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-card-red/40 bg-card-red/10 p-4 text-left"
          >
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-card-red opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-card-red" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-chalk">Session in progress</span>
              <span className="text-[13px] text-chalk-muted">Tap to keep recording</span>
            </span>
            <span className="text-chalk-muted">→</span>
          </button>
        </FadeIn>
      )}

      {!hasPlayed && !data.live_session && (
        <Card className="mb-6 border-volt-400/30 bg-volt-400/5">
          <h3 className="text-[17px]">Ready for your first session?</h3>
          <p className="mt-1 text-[14px] text-chalk-muted">
            Set up a match day, mark who turned up, and start recording goals.
          </p>
          <Button className="mt-4" onClick={() => navigate('/app/sessions/new')}>
            Start a session
          </Button>
        </Card>
      )}

      {/* Totals */}
      <div className="mb-7 grid grid-cols-4 gap-2.5">
        <StatTile label="Squad" value={data.totals.players} />
        <StatTile label="Sessions" value={data.totals.sessions} />
        <StatTile label="Goals" value={data.totals.goals} accent />
        <StatTile label="Assists" value={data.totals.assists} />
      </div>

      {/* Leaderboard preview */}
      <section className="mb-7">
        <SectionTitle
          action={
            <Link to="/app/leaderboard" className="text-[13px] text-volt-400">
              See all
            </Link>
          }
        >
          Table
        </SectionTitle>

        {data.leaderboard.length === 0 ? (
          <Card>
            <p className="py-2 text-center text-[14px] text-chalk-muted">
              No games played yet this month.
            </p>
          </Card>
        ) : (
          <Stagger className="surface divide-y divide-pitch-700 overflow-hidden">
            {data.leaderboard.map((row) => (
              <StaggerItem key={row.player_id}>
                <Link
                  to={`/app/players/${row.player_id}`}
                  className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-pitch-800"
                >
                  <RankBadge rank={row.rank ?? 0} />
                  <PlayerAvatar
                    name={row.players?.display_name ?? ''}
                    photoUrl={row.players?.photo_url}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-chalk">
                      {row.players?.display_name}
                    </span>
                    <span className="text-[12.5px] text-chalk-muted">
                      {row.goals}G · {row.assists}A · {row.appearances} apps
                    </span>
                  </span>
                  <span className="numeric text-xl text-volt-400">{points(row.total_points)}</span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      {/* Top performers */}
      {(data.top_scorer || data.top_assister || data.top_keeper) && (
        <section className="mb-7">
          <SectionTitle>Leading the way</SectionTitle>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <TopCard label="Top scorer" icon="⚽" stat={data.top_scorer} field="goals" />
            <TopCard label="Most assists" icon="🎯" stat={data.top_assister} field="assists" />
            <TopCard label="Clean sheets" icon="🧤" stat={data.top_keeper} field="clean_sheets" />
          </div>
        </section>
      )}

      {/* Recent sessions */}
      <section>
        <SectionTitle
          action={
            <Link to="/app/sessions" className="text-[13px] text-volt-400">
              See all
            </Link>
          }
        >
          Recent sessions
        </SectionTitle>

        {data.recent_sessions.length === 0 ? (
          <EmptyState
            icon="📅"
            title="No sessions yet"
            description="Your match days will show up here."
            action={<Button onClick={() => navigate('/app/sessions/new')}>Start a session</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {data.recent_sessions.map((session) => (
              <Link key={session.id} to={`/app/sessions/${session.id}`} className="block">
                <Card className="flex items-center gap-3 transition-colors hover:border-pitch-600">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] text-chalk">
                        {session.title || shortDate(session.session_date)}
                      </span>
                      {session.status === 'live' && <Badge tone="live">Live</Badge>}
                    </div>
                    <div className="mt-0.5 text-[13px] text-chalk-muted">
                      {session.matches?.length ?? 0} match
                      {(session.matches?.length ?? 0) === 1 ? '' : 'es'}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {(session.matches ?? []).slice(0, 3).map((m) => (
                      <span
                        key={m.id}
                        className="numeric rounded-lg bg-pitch-800 px-2 py-1 text-[13px] text-chalk-muted"
                      >
                        {m.side_a_score}–{m.side_b_score}
                      </span>
                    ))}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function TopCard({
  label,
  icon,
  stat,
  field,
}: {
  label: string
  icon: string
  stat: DashboardData['top_scorer']
  field: 'goals' | 'assists' | 'clean_sheets'
}) {
  if (!stat) {
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
        <PlayerAvatar
          name={stat.players?.display_name ?? ''}
          photoUrl={stat.players?.photo_url}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-[15px] text-chalk">
          {stat.players?.display_name}
        </span>
        <span className="numeric text-2xl text-volt-400">{stat[field]}</span>
      </div>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="px-5 pt-8">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-2 h-7 w-52" />
      <Skeleton className="mt-6 h-16 w-40" />
      <div className="mt-8 grid grid-cols-4 gap-2.5">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="mt-7 h-56" />
    </div>
  )
}
