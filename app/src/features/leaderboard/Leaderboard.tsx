import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import { Badge, Card, EmptyState, ErrorState, PlayerAvatar, PlayerName, RankBadge, Select, Skeleton } from '@/components/ui'
import { points } from '@/lib/format'
import type { Period, PlayerStats, StatsBreakdown } from '@/types'

export function LeaderboardScreen() {
  const { activeOrg } = useAuth()
  const [periodId, setPeriodId] = useState<string>('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: periods } = useQuery({
    queryKey: ['periods', activeOrg?.id],
    queryFn: async () => (await api.get<Period[]>('periods')).data,
    enabled: !!activeOrg,
  })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['leaderboard', activeOrg?.id, periodId],
    queryFn: async () => {
      const result = await api.get<PlayerStats[]>('stats/leaderboard', { period_id: periodId || undefined })
      return { rows: result.data, period: result.meta.period as Period }
    },
    enabled: !!activeOrg,
  })

  return (
    <div className="pb-8">
      <PageHeader
        title="Table"
        subtitle={data?.period?.label}
        action={
          (periods?.length ?? 0) > 1 ? (
            <Select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="h-9 w-auto text-[14px]"
            >
              <option value="">Current</option>
              {periods?.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          ) : undefined
        }
      />

      <div className="px-5">
        {data?.period?.status === 'closed' && (
          <div className="mb-4">
            <Badge>Final — this month is closed</Badge>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        ) : (data?.rows ?? []).length === 0 ? (
          <EmptyState
            icon="📊"
            title="Nothing to rank yet"
            description="Once you record your first session, the table fills in automatically."
          />
        ) : (
          <div className="surface divide-y divide-pitch-700 overflow-hidden">
            {/* Layout animation is what makes a rank change legible: the row
                physically travels to its new position rather than blinking. */}
            {(data?.rows ?? []).map((row) => {
              const isOpen = expanded === row.player_id
              return (
                <motion.div key={row.player_id} layout transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : row.player_id)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-pitch-800"
                  >
                    <RankBadge rank={row.rank ?? 0} />
                    <PlayerAvatar
                      name={row.players?.display_name ?? ''}
                      photoUrl={row.players?.photo_url}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <PlayerName
                        name={row.players?.display_name ?? ''}
                        whatsappNickname={row.players?.whatsapp_nickname}
                        className="block text-[15px] text-chalk"
                      />
                      <span className="text-[12.5px] text-chalk-muted">
                        {row.appearances} app{row.appearances === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="numeric text-2xl text-volt-400">{points(row.total_points)}</span>
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden bg-void/60"
                      >
                        <div className="grid grid-cols-3 gap-3 px-4 py-4 text-center sm:grid-cols-6">
                          <Breakdown label="Goals" value={row.goals} />
                          <Breakdown label="Assists" value={row.assists} />
                          <Breakdown label="Clean sheets" value={row.clean_sheets} />
                          <Breakdown label="Yellows" value={row.yellow_cards} />
                          <Breakdown label="Reds" value={row.red_cards} />
                          <Breakdown label="Punctuality" value={points(row.punctuality_score)} />
                        </div>
                        <SourceBreakdown playerId={row.player_id} periodId={row.period_id} active={isOpen} />

                        <div className="px-4 pb-4">
                          <Link
                            to={`/app/players/${row.player_id}`}
                            className="text-[13px] text-volt-400"
                          >
                            See full profile →
                          </Link>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        )}

        {(data?.rows ?? []).length > 0 && (
          <Card className="mt-4">
            <p className="text-[13px] leading-relaxed text-chalk-muted">
              Tap any player to see how their points were worked out. You can change what a goal,
              assist or clean sheet is worth in{' '}
              <Link to="/app/settings/scoring" className="text-volt-400">Settings</Link>.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}

function Breakdown({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="numeric text-xl text-chalk">{value}</div>
      <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-chalk-muted">{label}</div>
    </div>
  )
}

/**
 * "Where did these come from?" — a player's goals may include competition
 * matches, which count towards this total by default but can be toggled off
 * per competition in Settings. This is the opt-in detail behind that total,
 * not a second number competing with it.
 */
function SourceBreakdown({ playerId, periodId, active }: { playerId: string; periodId: string; active: boolean }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['stats-breakdown', playerId, periodId],
    queryFn: async () => (await api.get<StatsBreakdown>(`stats/${playerId}/breakdown`, { period_id: periodId })).data,
    enabled: active && open,
  })

  if (!active) return null

  return (
    <div className="px-4 pb-2">
      <button onClick={() => setOpen((v) => !v)} className="text-[12.5px] text-chalk-faint hover:text-chalk-muted">
        {open ? 'Hide' : 'Show'} where these goals came from ?
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-lg bg-pitch-800 px-3 py-2">
            <div className="text-chalk-muted">Sessions</div>
            <div className="numeric text-chalk">{data?.session?.goals ?? 0} goals · {data?.session?.assists ?? 0} assists</div>
          </div>
          <div className="rounded-lg bg-pitch-800 px-3 py-2">
            <div className="text-chalk-muted">Competitions</div>
            <div className="numeric text-chalk">{data?.competition?.goals ?? 0} goals · {data?.competition?.assists ?? 0} assists</div>
          </div>
        </div>
      )}
    </div>
  )
}
