import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Badge, Button, Card, SectionTitle, Skeleton, Toggle } from '@/components/ui'
import type { Period, PositionLine, PositionPoint, ScoringRule } from '@/types'

/* -------------------------------------------------------------------------- */
/* Per-month switches: position points and attendance tracking.               */
/* -------------------------------------------------------------------------- */

export function MonthSwitches() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [index, setIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: periods, isLoading } = useQuery({
    queryKey: ['periods', activeOrg?.id],
    queryFn: async () => (await api.get<Period[]>('periods')).data,
    enabled: !!activeOrg,
  })

  // Newest first from the API; start on the open month.
  const list = periods ?? []
  const openIndex = Math.max(0, list.findIndex((p) => p.status === 'open'))
  const current = list[index ?? openIndex]

  const save = useMutation({
    mutationFn: async (patch: Partial<Pick<Period, 'positional_scoring' | 'attendance_tracking'>>) =>
      api.patch(`periods/${current!.id}/switches`, patch),
    onMutate: () => setError(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['players'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not update that month'),
  })

  if (isLoading) return <Skeleton className="h-40" />
  if (!current) return null

  const i = index ?? openIndex
  const closed = current.status === 'closed'

  return (
    <div>
      <SectionTitle>Month by month</SectionTitle>
      <Card className="py-0">
        <div className="flex items-center justify-between border-b border-pitch-700 py-2.5">
          <button
            aria-label="Earlier month"
            disabled={i >= list.length - 1}
            onClick={() => setIndex(i + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-chalk-muted hover:bg-pitch-800 disabled:opacity-30"
          >
            <RiArrowLeftSLine className="h-5 w-5" />
          </button>
          <span className="flex items-center gap-2 text-[15px] font-semibold text-chalk">
            {current.label}
            {closed ? <Badge>Closed</Badge> : current.status === 'open' ? <Badge tone="volt">Now</Badge> : null}
          </span>
          <button
            aria-label="Later month"
            disabled={i <= 0}
            onClick={() => setIndex(i - 1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-chalk-muted hover:bg-pitch-800 disabled:opacity-30"
          >
            <RiArrowRightSLine className="h-5 w-5" />
          </button>
        </div>
        <div className="divide-y divide-pitch-700">
          <Toggle
            label="Position points"
            description="Goals and assists by midfielders, defenders and keepers are worth more"
            checked={!!current.positional_scoring}
            disabled={closed || save.isPending}
            onChange={(v) => save.mutate({ positional_scoring: v })}
          />
          <Toggle
            label="Track attendance"
            description={
              current.attendance_tracking
                ? 'Early, on time and late arrivals are scored'
                : 'Off — everyone who plays gets the early-arrival points'
            }
            checked={current.attendance_tracking ?? true}
            disabled={closed || save.isPending}
            onChange={(v) => save.mutate({ attendance_tracking: v })}
          />
        </div>
      </Card>
      <p className="mt-2 text-[13px] leading-relaxed text-chalk-muted">
        {closed
          ? `${current.label} is closed, so it keeps the settings it was scored with. Reopen it from Awards to change them.`
          : 'The table recalculates as soon as you flip a switch, and flipping it back puts every number back. A new month starts with the same settings as the one before it.'}
      </p>
      {error && <p className="mt-2 text-[14px] text-card-red">{error}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* What a goal / assist is worth for each position group.                     */
/* -------------------------------------------------------------------------- */

const LINES: { line: PositionLine; label: string; hint: string }[] = [
  { line: 'FWD', label: 'Forwards', hint: 'Wingers and strikers' },
  { line: 'MID', label: 'Midfielders', hint: 'Defensive, centre, attacking, wide mids' },
  { line: 'DEF', label: 'Defenders', hint: 'Full backs and centre backs' },
  { line: 'GK', label: 'Goalkeepers', hint: 'Registered keepers' },
]

type Pair = { goal: number; assist: number }
type Grid = Record<PositionLine, Pair>

/**
 * The one place goal and assist values are set. The first row is the flat
 * value (scoring_rules): used by everyone when Position points is off, and by
 * players with no position when it's on. The rest are position_points.
 */
export function GoalAssistPoints() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [grid, setGrid] = useState<Grid | null>(null)
  const [base, setBase] = useState<Pair | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['position-points', activeOrg?.id],
    queryFn: async () => (await api.get<PositionPoint[]>('scoring/position-points')).data,
    enabled: !!activeOrg,
  })

  const { data: rules } = useQuery({
    queryKey: ['scoring-rules', activeOrg?.id],
    queryFn: async () => (await api.get<ScoringRule[]>('scoring/rules')).data,
    enabled: !!activeOrg,
  })

  const { data: periods } = useQuery({
    queryKey: ['periods', activeOrg?.id],
    queryFn: async () => (await api.get<Period[]>('periods')).data,
    enabled: !!activeOrg,
  })
  const open = periods?.find((p) => p.status === 'open')

  useEffect(() => {
    if (!data) return
    const next = {} as Grid
    for (const { line } of LINES) next[line] = { goal: 0, assist: 0 }
    for (const row of data) {
      if (row.line in next) next[row.line][row.event_type] = Number(row.points)
    }
    setGrid(next)
  }, [data])

  useEffect(() => {
    if (!rules) return
    const pick = (t: string) => Number(rules.find((r) => r.event_type === t)?.points ?? 0)
    setBase({ goal: pick('goal'), assist: pick('assist') })
  }, [rules])

  const save = useMutation({
    mutationFn: async ({ g, b }: { g: Grid; b: Pair }) => {
      const enabled = (t: string) => rules?.find((r) => r.event_type === t)?.enabled ?? true
      await api.put('scoring/rules', {
        rules: [
          { event_type: 'goal', points: b.goal, enabled: enabled('goal') },
          { event_type: 'assist', points: b.assist, enabled: enabled('assist') },
        ],
      })
      return api.put('scoring/position-points', {
        points: LINES.flatMap(({ line }) => [
          { line, event_type: 'goal', points: g[line].goal },
          { line, event_type: 'assist', points: g[line].assist },
        ]),
      })
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-points'] })
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save those points'),
  })

  if (isLoading || !grid || !base) return <Skeleton className="h-56" />

  const positional = !!open?.positional_scoring

  const rows: { key: string; label: string; hint: string; value: Pair; set: (k: keyof Pair, v: number) => void; muted: boolean }[] = [
    {
      key: 'base',
      label: 'Normal points',
      hint: positional ? 'Players with no position' : 'Everyone, this month',
      value: base,
      set: (k, v) => setBase((b) => (b ? { ...b, [k]: v } : b)),
      muted: false,
    },
    ...LINES.map(({ line, label, hint }) => ({
      key: line,
      label,
      hint,
      value: grid[line],
      set: (k: keyof Pair, v: number) => setGrid((g) => (g ? { ...g, [line]: { ...g[line], [k]: v } } : g)),
      muted: !positional,
    })),
  ]

  return (
    <div>
      <SectionTitle>Goals and assists</SectionTitle>
      <Card className="py-0">
        <div className="flex items-center gap-3 border-b border-pitch-700 py-2 text-[12px] uppercase tracking-wide text-chalk-faint">
          <span className="flex-1">Who</span>
          <span className="w-16 text-center">Goal</span>
          <span className="w-16 text-center">Assist</span>
        </div>
        <div className="divide-y divide-pitch-700">
          {rows.map((row, i) => (
            <div key={row.key}>
              {i === 1 && (
                <p className="pt-3 text-[12px] uppercase tracking-wide text-chalk-faint">
                  By position {positional ? '' : '— off this month'}
                </p>
              )}
              <div className={`flex items-center gap-3 py-3 ${row.muted ? 'opacity-50' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-chalk">{row.label}</span>
                  <span className="block text-[12.5px] text-chalk-muted">{row.hint}</span>
                </span>
                {(['goal', 'assist'] as const).map((k) => (
                  <input
                    key={k}
                    type="number"
                    step="0.5"
                    aria-label={`${row.label} ${k}`}
                    value={row.value[k]}
                    onChange={(e) => row.set(k, Number(e.target.value))}
                    className="numeric h-10 w-16 rounded-lg border border-pitch-700 bg-pitch-800 px-2 text-center text-[16px] text-chalk focus:border-turf-400 focus:outline-none"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <p className="mt-2 text-[13px] leading-relaxed text-chalk-muted">
        {positional
          ? 'Position points are on this month, so each player earns their position\'s values. '
          : 'Position points are off this month, so everyone earns the normal points. The position values are kept ready for when you switch it on. '}
        Clean sheets and everything else are set below and are the same for everyone.
      </p>
      {error && <p className="mt-2 text-[14px] text-card-red">{error}</p>}
      <Button
        className="mt-3"
        fullWidth
        loading={save.isPending}
        onClick={() => save.mutate({ g: grid, b: base })}
      >
        {saved ? 'Saved — table updated ✓' : 'Save goals and assists'}
      </Button>
    </div>
  )
}
