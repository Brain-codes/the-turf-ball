import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Badge, Button, Card, SectionTitle, Skeleton, Toggle } from '@/components/ui'
import type { Period, PositionLine, PositionPoint } from '@/types'

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
  { line: 'FWD', label: 'Forwards', hint: 'Wingers, strikers — and anyone with no position' },
  { line: 'MID', label: 'Midfielders', hint: 'Defensive, centre, attacking, wide mids' },
  { line: 'DEF', label: 'Defenders', hint: 'Full backs and centre backs' },
  { line: 'GK', label: 'Goalkeepers', hint: 'Registered keepers' },
]

type Grid = Record<PositionLine, { goal: number; assist: number }>

export function PositionPointsEditor() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [grid, setGrid] = useState<Grid | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['position-points', activeOrg?.id],
    queryFn: async () => (await api.get<PositionPoint[]>('scoring/position-points')).data,
    enabled: !!activeOrg,
  })

  useEffect(() => {
    if (!data) return
    const next = {} as Grid
    for (const { line } of LINES) next[line] = { goal: 0, assist: 0 }
    for (const row of data) next[row.line][row.event_type] = Number(row.points)
    setGrid(next)
  }, [data])

  const save = useMutation({
    mutationFn: async (g: Grid) =>
      api.put('scoring/position-points', {
        points: LINES.flatMap(({ line }) => [
          { line, event_type: 'goal', points: g[line].goal },
          { line, event_type: 'assist', points: g[line].assist },
        ]),
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['position-points'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save those points'),
  })

  if (isLoading || !grid) return <Skeleton className="h-56" />

  function set(line: PositionLine, key: 'goal' | 'assist', value: number) {
    setGrid((g) => (g ? { ...g, [line]: { ...g[line], [key]: value } } : g))
  }

  return (
    <div>
      <SectionTitle>Goals and assists by position</SectionTitle>
      <Card className="py-0">
        <div className="flex items-center gap-3 border-b border-pitch-700 py-2 text-[12px] uppercase tracking-wide text-chalk-faint">
          <span className="flex-1">Position</span>
          <span className="w-16 text-center">Goal</span>
          <span className="w-16 text-center">Assist</span>
        </div>
        <div className="divide-y divide-pitch-700">
          {LINES.map(({ line, label, hint }) => (
            <div key={line} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-chalk">{label}</span>
                <span className="block text-[12.5px] text-chalk-muted">{hint}</span>
              </span>
              {(['goal', 'assist'] as const).map((key) => (
                <input
                  key={key}
                  type="number"
                  step="0.5"
                  aria-label={`${label} ${key}`}
                  value={grid[line][key]}
                  onChange={(e) => set(line, key, Number(e.target.value))}
                  className="numeric h-10 w-16 rounded-lg border border-pitch-700 bg-pitch-800 px-2 text-center text-[16px] text-chalk focus:border-turf-400 focus:outline-none"
                />
              ))}
            </div>
          ))}
        </div>
      </Card>
      <p className="mt-2 text-[13px] leading-relaxed text-chalk-muted">
        Only used in months with Position points switched on. Clean sheets stay the same for
        everyone. A player's position is set when they join and can be changed by an admin.
      </p>
      {error && <p className="mt-2 text-[14px] text-card-red">{error}</p>}
      <Button
        className="mt-3"
        fullWidth
        loading={save.isPending}
        onClick={() => save.mutate(grid)}
      >
        {saved ? 'Saved — table updated ✓' : 'Save position points'}
      </Button>
    </div>
  )
}
