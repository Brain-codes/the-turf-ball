import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input,
  PlayerAvatar, PlayerName, SectionTitle, Skeleton, Spinner, Toggle,
} from '@/components/ui'
import { FadeIn, Sheet } from '@/components/motion'
import { cn } from '@/lib/cn'
import { fullDate, shortDate, time } from '@/lib/format'
import type { Competition, CompetitionFixture, CompetitionTeam, Player, StandingsRow, TeamBalance } from '@/types'

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

const STATUS_LABEL: Record<string, string> = {
  draft: 'Setting up',
  drafting_teams: 'Teams drawn',
  scheduled: 'Fixtures ready',
  live: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function CompetitionsScreen() {
  const { activeOrg } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['competitions', activeOrg?.id],
    queryFn: async () => (await api.get<Competition[]>('competitions')).data,
    enabled: !!activeOrg,
  })

  const competitions = data ?? []
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  return (
    <div className="pb-8">
      <PageHeader
        title="Competitions"
        subtitle="One-off and season-long tournaments, separate from your regular sessions."
        action={isAdmin && <Button onClick={() => navigate('/app/competitions/new')}>New</Button>}
      />

      <div className="px-5">
        {isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        ) : competitions.length === 0 ? (
          <EmptyState
            icon="🏆"
            title="No competitions yet"
            description="A competition is a tournament — draw balanced teams, generate fixtures, and let the table look after itself."
            action={isAdmin && <Button onClick={() => navigate('/app/competitions/new')}>Start a competition</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {competitions.map((c) => (
              <Link key={c.id} to={`/app/competitions/${c.id}`}>
                <Card className="transition-colors hover:border-pitch-600">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] text-chalk">{c.name}</span>
                        {c.status === 'live' && <Badge tone="live">Live</Badge>}
                        {c.status !== 'live' && c.status !== 'cancelled' && <Badge>{STATUS_LABEL[c.status]}</Badge>}
                        {c.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
                        {!c.count_toward_stats && <Badge tone="warn">Stats excluded</Badge>}
                      </div>
                      <div className="mt-0.5 text-[13px] text-chalk-muted">
                        {c.starts_on === c.ends_on ? fullDate(c.starts_on) : `${shortDate(c.starts_on)} – ${shortDate(c.ends_on)}`}
                        {' · '}{c.team_count} teams
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export function NewCompetitionScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [endsOn, setEndsOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [dayEndsAt, setDayEndsAt] = useState('18:00')
  const [teamCount, setTeamCount] = useState(4)
  const [squadSize, setSquadSize] = useState(8)
  const [pitchSize, setPitchSize] = useState(7)
  const [doubleRoundRobin, setDoubleRoundRobin] = useState(true)
  const [matchDurationMinutes, setMatchDurationMinutes] = useState('')
  const [countTowardStats, setCountTowardStats] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const singleDay = startsOn === endsOn

  const create = useMutation({
    mutationFn: async () =>
      api.post<Competition>('competitions', {
        name,
        starts_on: startsOn,
        ends_on: endsOn,
        day_ends_at: singleDay ? dayEndsAt : null,
        team_count: teamCount,
        squad_size: squadSize,
        pitch_size: pitchSize,
        double_round_robin: doubleRoundRobin,
        match_duration_minutes: matchDurationMinutes ? Number(matchDurationMinutes) : null,
        count_toward_stats: countTowardStats,
      }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['competitions'] })
      navigate(`/app/competitions/${data.id}`)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create that competition'),
  })

  return (
    <div className="pb-8">
      <PageHeader title="New competition" />
      <FadeIn className="space-y-5 px-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer Cup" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends" hint={singleDay ? 'Same day — a one-evening tournament' : 'Runs across multiple days'}>
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} min={startsOn} />
          </Field>
        </div>

        {singleDay && (
          <Field label="Finishes by" hint="Used to space out matches so they all fit before this time.">
            <Input type="time" value={dayEndsAt} onChange={(e) => setDayEndsAt(e.target.value)} />
          </Field>
        )}

        <Field
          label="Minutes per match"
          hint={
            singleDay
              ? 'Leave blank to work it out automatically from your finish time and the number of fixtures.'
              : 'How long each match runs. You can still move fixtures to different days afterwards.'
          }
        >
          <Input
            type="number"
            min={1}
            max={180}
            placeholder="Auto"
            value={matchDurationMinutes}
            onChange={(e) => setMatchDurationMinutes(e.target.value)}
          />
        </Field>

        <SectionTitle>Shape</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Teams">
            <Input type="number" min={2} max={16} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} />
          </Field>
          <Field label="Squad size" hint="Per team">
            <Input type="number" min={2} max={60} value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))} />
          </Field>
          <Field label="On the pitch" hint="Playing at once">
            <Input type="number" min={1} max={squadSize} value={pitchSize} onChange={(e) => setPitchSize(Number(e.target.value))} />
          </Field>
        </div>

        <Card>
          <Toggle
            checked={doubleRoundRobin}
            onChange={setDoubleRoundRobin}
            label="Double round-robin"
            description="Every team plays every other team twice instead of once."
          />
        </Card>

        <Card>
          <Toggle
            checked={countTowardStats}
            onChange={setCountTowardStats}
            label="Count towards player stats"
            description="Goals and other stats from this competition add to each player's normal record. You can change this later, for this competition only, in Settings."
          />
        </Card>

        {error && <p className="text-[13px] text-card-red">{error}</p>}

        <Button fullWidth size="lg" loading={create.isPending} disabled={!name.trim()} onClick={() => { setError(null); create.mutate() }}>
          Create competition
        </Button>
      </FadeIn>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Detail — roster, draft, fixtures, standings                                 */
/* -------------------------------------------------------------------------- */

type Tab = 'roster' | 'teams' | 'fixtures' | 'standings'

export function CompetitionDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const { activeOrg } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('roster')
  const [editOpen, setEditOpen] = useState(false)
  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const { data: competition, isLoading, error, refetch } = useQuery({
    queryKey: ['competition', id],
    queryFn: async () => (await api.get<Competition>(`competitions/${id}`)).data,
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="px-5 pt-6">
        <Skeleton className="h-24" />
      </div>
    )
  }
  if (error || !competition) {
    return <div className="px-5 pt-6"><ErrorState message={(error as Error)?.message ?? 'Not found'} onRetry={refetch} /></div>
  }

  const teamsDrawn = (competition.competition_teams?.length ?? 0) > 0
  const cancelled = competition.status === 'cancelled'

  return (
    <div className="pb-8">
      <PageHeader
        title={competition.name}
        subtitle={
          (cancelled ? 'Cancelled — ' : '') +
          (competition.starts_on === competition.ends_on
            ? fullDate(competition.starts_on)
            : `${shortDate(competition.starts_on)} – ${shortDate(competition.ends_on)}`)
        }
        action={
          isAdmin && !cancelled ? (
            <button
              className="rounded-full bg-pitch-800 px-3 py-1.5 text-[13px] text-chalk-muted hover:text-chalk"
              onClick={() => setEditOpen(true)}
            >
              Edit ✎
            </button>
          ) : undefined
        }
      />

      {editOpen && (
        <EditCompetitionSheet
          competition={competition}
          onClose={() => setEditOpen(false)}
          onCancelled={() => navigate('/app/competitions', { replace: true })}
        />
      )}

      <div className="mb-4 flex gap-2 overflow-x-auto px-5">
        {(['roster', 'teams', 'fixtures', 'standings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              tab === t ? 'bg-volt-400 text-void' : 'bg-pitch-800 text-chalk-muted hover:text-chalk',
            )}
          >
            {t === 'roster' ? 'Squad' : t === 'teams' ? 'Teams' : t === 'fixtures' ? 'Fixtures' : 'Table'}
          </button>
        ))}
      </div>

      <div className="px-5">
        {tab === 'roster' && <RosterTab competition={competition} isAdmin={isAdmin} />}
        {tab === 'teams' && <TeamsTab competition={competition} isAdmin={isAdmin} teamsDrawn={teamsDrawn} />}
        {tab === 'fixtures' && <FixturesTab competition={competition} isAdmin={isAdmin} teamsDrawn={teamsDrawn} />}
        {tab === 'standings' && <StandingsTab competitionId={competition.id} />}
      </div>
    </div>
  )
}

/* --- Edit / cancel a competition --------------------------------------------- */

function EditCompetitionSheet({
  competition, onClose, onCancelled,
}: {
  competition: Competition
  onClose: () => void
  onCancelled: () => void
}) {
  const queryClient = useQueryClient()
  const singleDayInitially = competition.starts_on === competition.ends_on
  const [name, setName] = useState(competition.name)
  const [startsOn, setStartsOn] = useState(competition.starts_on)
  const [endsOn, setEndsOn] = useState(competition.ends_on)
  const [dayEndsAt, setDayEndsAt] = useState(competition.day_ends_at ?? '18:00')
  const [matchDurationMinutes, setMatchDurationMinutes] = useState(
    competition.match_duration_minutes != null ? String(competition.match_duration_minutes) : '',
  )
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const singleDay = startsOn === endsOn

  const save = useMutation({
    mutationFn: async () =>
      api.patch(`competitions/${competition.id}`, {
        name,
        starts_on: startsOn,
        ends_on: endsOn,
        day_ends_at: singleDay ? dayEndsAt : null,
        match_duration_minutes: matchDurationMinutes ? Number(matchDurationMinutes) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competition', competition.id] })
      queryClient.invalidateQueries({ queryKey: ['competitions'] })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save those changes'),
  })

  // A setback — the venue fell through, not enough players turned up — is
  // exactly what this covers. Cancelling is a soft-void: the competition
  // stays in history, clearly labelled, and every match already played
  // keeps its record. Nothing about a past matchday disappears.
  const cancel = useMutation({
    mutationFn: async () => api.post(`competitions/${competition.id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitions'] })
      onCancelled()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not cancel that competition'),
  })

  return (
    <Sheet open onClose={onClose} title="Edit competition">
      <div className="space-y-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} min={startsOn} />
          </Field>
        </div>

        {singleDay && (
          <Field label="Finishes by">
            <Input type="time" value={dayEndsAt} onChange={(e) => setDayEndsAt(e.target.value)} />
          </Field>
        )}

        <Field
          label="Minutes per match"
          hint={singleDay ? 'Leave blank to work it out automatically.' : 'How long each match runs.'}
        >
          <Input
            type="number"
            min={1}
            max={180}
            placeholder="Auto"
            value={matchDurationMinutes}
            onChange={(e) => setMatchDurationMinutes(e.target.value)}
          />
        </Field>

        {!singleDayInitially && startsOn !== endsOn && (
          <p className="text-[12.5px] text-chalk-muted">
            Fixtures already scheduled on days outside the new range will need to be moved on the Fixtures tab.
          </p>
        )}

        {error && <p className="text-[13px] text-card-red">{error}</p>}

        <Button fullWidth loading={save.isPending} disabled={!name.trim()} onClick={() => { setError(null); save.mutate() }}>
          Save changes
        </Button>

        <div>
          <SectionTitle>Danger zone</SectionTitle>
          <Card className="border-card-red/30 bg-card-red/5">
            {!confirmingCancel ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] leading-relaxed text-chalk-muted">
                  Called off, forfeited, or the venue fell through — cancel it. Anything already
                  played stays on record; the competition itself just stops.
                </p>
                <Button variant="danger" size="sm" onClick={() => setConfirmingCancel(true)}>
                  Cancel…
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[14px] text-chalk">
                  Cancel "{competition.name}"? Matches already played keep their record — this just stops the competition.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    fullWidth
                    loading={cancel.isPending}
                    onClick={() => { setError(null); cancel.mutate() }}
                  >
                    Yes, cancel it
                  </Button>
                  <Button variant="ghost" fullWidth onClick={() => setConfirmingCancel(false)}>
                    Never mind
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Sheet>
  )
}

/* --- Roster: who's in ------------------------------------------------------- */

function RosterTab({ competition, isAdmin }: { competition: Competition; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)

  const { data: squad } = useQuery({
    queryKey: ['players', competition.organization_id],
    queryFn: async () => (await api.get<Player[]>('players')).data,
  })

  const joined = competition.competition_players?.filter((cp) => !cp.removed_at) ?? []
  const joinedIds = new Set(joined.map((cp) => cp.player_id))
  const available = (squad ?? []).filter((p) => !joinedIds.has(p.id) && p.status === 'active')

  function toggleSelected(playerId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  const add = useMutation({
    mutationFn: async (playerId: string) => api.post(`competitions/${competition.id}/players`, { player_id: playerId }),
  })

  async function addSelected() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setIsAdding(true)
    // Fire together — each player is an independent row, so one failing
    // shouldn't hold the rest up waiting behind it. One shared loader on the
    // button is enough; a spinner per row just repeats the same information.
    await Promise.allSettled(ids.map((id) => add.mutateAsync(id)))
    setSelected(new Set())
    setIsAdding(false)
    queryClient.invalidateQueries({ queryKey: ['competition', competition.id] })
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === available.length ? new Set() : new Set(available.map((p) => p.id))))
  }

  const quickAdd = useMutation({
    mutationFn: async () =>
      api.post(`competitions/${competition.id}/players`, { new_player: { display_name: quickName } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competition', competition.id] })
      setQuickName('')
    },
  })

  // Tracked per-player, not on the mutation's own isPending — that only ever
  // reflects the single most recent call, so removing B while A is still in
  // flight would silently steal A's spinner. Each row owns its own entry
  // instead, and removals never wait on each other.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())

  async function removePlayer(playerId: string) {
    setRemovingIds((prev) => new Set(prev).add(playerId))
    try {
      await api.del(`competitions/${competition.id}/players/${playerId}`)
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(playerId)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['competition', competition.id] })
    }
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card>
          <SectionTitle>Quick-add someone new</SectionTitle>
          <div className="flex gap-2">
            <Input value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Name" className="flex-1" />
            <Button disabled={!quickName.trim()} loading={quickAdd.isPending} onClick={() => quickAdd.mutate()}>Add</Button>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <SectionTitle
            action={
              <button
                className="text-[13px] text-volt-400"
                onClick={() => { setPickerOpen((v) => !v); setSelected(new Set()) }}
              >
                {pickerOpen ? 'Close' : 'From squad'}
              </button>
            }
          >
            Add from squad
          </SectionTitle>
          {pickerOpen && (
            <>
              {available.length > 0 && (
                <div className="mb-1 flex justify-end">
                  <button
                    className="text-[13px] text-chalk-muted hover:text-chalk"
                    disabled={isAdding}
                    onClick={toggleSelectAll}
                  >
                    {selected.size === available.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
              )}
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {available.length === 0 ? (
                  <p className="py-3 text-[13px] text-chalk-muted">Everyone in the squad has already joined.</p>
                ) : available.map((p) => {
                  const isSelected = selected.has(p.id)
                  return (
                    <button
                      key={p.id}
                      disabled={isAdding}
                      onClick={() => toggleSelected(p.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-pitch-800',
                        isSelected && 'bg-pitch-800',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                          isSelected ? 'border-volt-400 bg-volt-400 text-void' : 'border-pitch-600 text-transparent',
                        )}
                      >
                        ✓
                      </span>
                      <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                      <PlayerName
                        name={p.display_name}
                        whatsappNickname={p.whatsapp_nickname}
                        className="min-w-0 flex-1 text-[14px] text-chalk"
                      />
                    </button>
                  )
                })}
              </div>
              {selected.size > 0 && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" loading={isAdding} onClick={addSelected}>
                    Add {selected.size} player{selected.size === 1 ? '' : 's'}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <SectionTitle>{joined.length} joined</SectionTitle>
      {joined.length === 0 ? (
        <EmptyState icon="👥" title="Nobody's joined yet" description="Add players from the squad or quick-add someone new." />
      ) : (
        <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2 xl:grid-cols-3">
          {joined.map((cp) => {
            const isRemoving = removingIds.has(cp.player_id)
            return (
              <Card key={cp.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <PlayerAvatar name={cp.players?.display_name ?? ''} photoUrl={cp.players?.photo_url} size="sm" />
                  <PlayerName name={cp.players?.display_name ?? ''} whatsappNickname={cp.players?.whatsapp_nickname} className="text-[14px] text-chalk" />
                </div>
                {isAdmin && (
                  isRemoving ? (
                    <Spinner className="text-chalk-faint" />
                  ) : (
                    <button
                      className="text-[12.5px] text-chalk-faint hover:text-card-red"
                      onClick={() => removePlayer(cp.player_id)}
                    >
                      Remove
                    </button>
                  )
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* --- Teams: draft + edit ----------------------------------------------------- */

function TeamsTab({ competition, isAdmin, teamsDrawn }: { competition: Competition; isAdmin: boolean; teamsDrawn: boolean }) {
  const queryClient = useQueryClient()
  // Off by default: small-sided games (5-/7-a-side) don't really have a back
  // four and a front three, so the draft balances by quality alone unless a
  // group specifically wants the finer defence/midfield/attack split.
  const [strictPositions, setStrictPositions] = useState(false)

  // Redrawing or moving a player changes who's on which team, which is
  // exactly what the strength rating (§competition-balance) is computed
  // from — invalidating only ['competition', id] left that badge showing a
  // stale number until a full reload. Every roster-changing mutation here
  // refreshes both queries so the screen reflects the move immediately.
  const refreshAfterRosterChange = () => {
    queryClient.invalidateQueries({ queryKey: ['competition', competition.id] })
    queryClient.invalidateQueries({ queryKey: ['competition-balance', competition.id] })
  }

  const draft = useMutation({
    mutationFn: async () =>
      api.post<{ overflow_teams: { team_id: string; count_over_base: number }[] }>(
        `competitions/${competition.id}/draft`,
        { strict_positions: strictPositions },
      ),
    onSuccess: refreshAfterRosterChange,
  })

  const renameTeam = useMutation({
    mutationFn: async ({ teamId, name }: { teamId: string; name: string }) =>
      api.patch(`competitions/${competition.id}/teams/${teamId}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['competition', competition.id] }),
  })

  const setCaptain = useMutation({
    mutationFn: async ({ teamId, playerId }: { teamId: string; playerId: string }) =>
      api.patch(`competitions/${competition.id}/teams/${teamId}`, { captain_player_id: playerId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['competition', competition.id] }),
  })

  const moveToTeam = useMutation({
    mutationFn: async ({ teamId, playerId }: { teamId: string; playerId: string }) =>
      api.post(`competitions/${competition.id}/teams/${teamId}/players`, { player_id: playerId }),
    onSuccess: refreshAfterRosterChange,
  })

  const removeFromTeam = useMutation({
    mutationFn: async ({ teamId, playerId }: { teamId: string; playerId: string }) =>
      api.del(`competitions/${competition.id}/teams/${teamId}/players/${playerId}`),
    onSuccess: refreshAfterRosterChange,
  })

  const teams = competition.competition_teams ?? []

  const { data: balance } = useQuery({
    queryKey: ['competition-balance', competition.id],
    queryFn: async () => (await api.get<TeamBalance[]>(`competitions/${competition.id}/balance`)).data,
    enabled: teamsDrawn,
  })
  const balanceByTeam = new Map((balance ?? []).map((b) => [b.team_id, b]))

  return (
    <div className="space-y-4">
      {isAdmin && (
        <>
          <Card className="py-2.5">
            <Toggle
              label="Strict positioning"
              description="Balance defence, midfield and attack separately. Leave off for 5-/7-a-side, where that split rarely matches how the game's actually played — quality alone is usually the fairer draw."
              checked={strictPositions}
              onChange={setStrictPositions}
            />
          </Card>
          <Button fullWidth loading={draft.isPending} onClick={() => draft.mutate()}>
            {teamsDrawn ? 'Re-draw teams' : 'Draw teams'}
          </Button>
        </>
      )}

      {!teamsDrawn ? (
        <EmptyState icon="🎲" title="Teams not drawn yet" description="One tap spreads quality evenly across every team — everyone gets a keeper, then it balances by form. You can move players around afterwards." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              isAdmin={isAdmin}
              allTeams={teams}
              strength={balanceByTeam.get(team.id)?.strength_rating}
              pendingCaptainPlayerId={
                setCaptain.isPending && setCaptain.variables?.teamId === team.id
                  ? setCaptain.variables.playerId
                  : null
              }
              onRename={(name) => renameTeam.mutate({ teamId: team.id, name })}
              onSetCaptain={(playerId) => setCaptain.mutate({ teamId: team.id, playerId })}
              onMoveTo={(targetTeamId, playerId) => moveToTeam.mutate({ teamId: targetTeamId, playerId })}
              onRemove={(playerId) => removeFromTeam.mutate({ teamId: team.id, playerId })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TeamCard({
  team, isAdmin, allTeams, strength, pendingCaptainPlayerId, onRename, onSetCaptain, onMoveTo, onRemove,
}: {
  team: CompetitionTeam
  isAdmin: boolean
  allTeams: CompetitionTeam[]
  strength?: number | null
  pendingCaptainPlayerId?: string | null
  onRename: (name: string) => void
  onSetCaptain: (playerId: string) => void
  onMoveTo: (targetTeamId: string, playerId: string) => void
  onRemove: (playerId: string) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const fallbackName = `Team ${String.fromCharCode(65 + Math.max(0, allTeams.findIndex((t) => t.id === team.id)))}`
  const [name, setName] = useState(team.name || fallbackName)
  const players = team.competition_team_players?.filter((tp) => !tp.removed_at) ?? []

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        {editingName && isAdmin ? (
          <div className="flex flex-1 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" autoFocus />
            <Button size="sm" onClick={() => { onRename(name); setEditingName(false) }}>Save</Button>
          </div>
        ) : (
          <button
            className="group flex items-center gap-1.5 text-left text-[15px] font-semibold text-chalk disabled:cursor-default"
            disabled={!isAdmin}
            onClick={() => setEditingName(true)}
          >
            {team.name || fallbackName}
            {isAdmin && (
              <span className="text-[13px] text-chalk-faint transition-colors group-hover:text-volt-400" aria-hidden>
                ✎
              </span>
            )}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {strength != null && (
            <span title="Team strength relative to tonight's average — 100 is exactly level">
              <Badge tone={strength >= 110 ? 'volt' : undefined}>⚡ {strength}</Badge>
            </span>
          )}
          <Badge>{players.length} players</Badge>
        </div>
      </div>

      <div className="space-y-1">
        {players.map((tp) => (
          <div key={tp.id} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <PlayerAvatar name={tp.players?.display_name ?? ''} photoUrl={tp.players?.photo_url} size="xs" />
              <PlayerName name={tp.players?.display_name ?? ''} whatsappNickname={tp.players?.whatsapp_nickname} className="text-[13.5px] text-chalk" />
              {team.captain_player_id === tp.player_id && <Badge tone="volt">Captain</Badge>}
            </div>
            {isAdmin && (
              <div className="flex shrink-0 items-center gap-2 text-[12px]">
                {pendingCaptainPlayerId === tp.player_id ? (
                  <Spinner className="text-volt-400" />
                ) : team.captain_player_id !== tp.player_id ? (
                  <button className="text-chalk-faint hover:text-volt-400" onClick={() => onSetCaptain(tp.player_id)}>Captain</button>
                ) : null}
                <select
                  className="rounded bg-transparent text-chalk-faint hover:text-chalk"
                  value=""
                  onChange={(e) => e.target.value && onMoveTo(e.target.value, tp.player_id)}
                >
                  <option value="">Move…</option>
                  {allTeams.filter((t) => t.id !== team.id).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name || `Team ${String.fromCharCode(65 + Math.max(0, allTeams.findIndex((x) => x.id === t.id)))}`}
                    </option>
                  ))}
                </select>
                <button className="text-chalk-faint hover:text-card-red" onClick={() => onRemove(tp.player_id)}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

/* --- Fixtures ---------------------------------------------------------------- */

interface FixtureSettingsBody {
  match_duration_minutes: number | null
  day_starts_at: string | null
  day_ends_at: string | null
  evening_starts_at: string | null
  evening_ends_at: string | null
  matches_per_day: number | null
  concurrent_matches: number
  break_between_matches_minutes: number
  split_into_halves: boolean
  halftime_break_minutes: number | null
}

function FixturesTab({ competition, isAdmin, teamsDrawn }: { competition: Competition; isAdmin: boolean; teamsDrawn: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ['competition-fixtures', competition.id],
    queryFn: async () => (await api.get<CompetitionFixture[]>(`competitions/${competition.id}/fixtures`)).data,
  })

  const generate = useMutation({
    mutationFn: async (settings: FixtureSettingsBody) => api.post(`competitions/${competition.id}/rounds`, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competition-fixtures', competition.id] })
      queryClient.invalidateQueries({ queryKey: ['competition', competition.id] })
      setSettingsOpen(false)
    },
  })

  const start = useMutation({
    mutationFn: async (fixtureId: string) => api.post<{ id: string }>(`competitions/${competition.id}/fixtures/${fixtureId}/start`),
    onSuccess: (_result, fixtureId) => {
      queryClient.invalidateQueries({ queryKey: ['competition-fixtures', competition.id] })
      navigate(`/app/competitions/${competition.id}/fixtures/${fixtureId}/live`)
    },
  })

  if (isLoading) return <Skeleton className="h-32" />

  const list = fixtures ?? []

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex gap-2">
          <Button
            fullWidth
            disabled={!teamsDrawn}
            loading={generate.isPending}
            // First time there's nothing to generate from yet, the settings
            // sheet opens instead of firing straight off with defaults —
            // minutes-per-match and the rest are too important to guess.
            // Once fixtures exist, the same button just re-runs with
            // whatever was set last; the gear is there to change that first.
            onClick={() => (list.length === 0 ? setSettingsOpen(true) : generate.mutate({
              match_duration_minutes: competition.match_duration_minutes,
              day_starts_at: competition.day_starts_at,
              day_ends_at: competition.day_ends_at,
              evening_starts_at: competition.evening_starts_at,
              evening_ends_at: competition.evening_ends_at,
              matches_per_day: competition.matches_per_day,
              concurrent_matches: competition.concurrent_matches,
              break_between_matches_minutes: competition.break_between_matches_minutes,
              split_into_halves: competition.split_into_halves,
              halftime_break_minutes: competition.halftime_break_minutes,
            }))}
          >
            {list.length === 0 ? 'Generate fixtures' : 'Re-generate fixtures'}
          </Button>
          {list.length > 0 && (
            <button
              className="shrink-0 rounded-lg bg-pitch-800 px-3 text-[15px] text-chalk-muted hover:text-chalk"
              onClick={() => setSettingsOpen(true)}
              title="Fixture settings"
            >
              ⚙
            </button>
          )}
        </div>
      )}
      {isAdmin && !teamsDrawn && !list.length && (
        <p className="text-[13px] text-chalk-muted">Draw teams first, on the Teams tab.</p>
      )}

      {settingsOpen && (
        <FixtureSettingsSheet
          competition={competition}
          pending={generate.isPending}
          onClose={() => setSettingsOpen(false)}
          onGenerate={(settings) => generate.mutate(settings)}
        />
      )}

      {list.length === 0 ? (
        <EmptyState icon="📋" title="No fixtures yet" description="Generated automatically once teams are drawn — one tap builds the whole schedule." />
      ) : (
        <div className="space-y-2">
          {list.map((f) => {
            const match = f.matches
            const isLive = match?.status === 'live'
            const isDone = match?.status === 'completed'
            return (
              <Card key={f.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] text-chalk">
                    {f.home_team?.name || 'TBD'} <span className="text-chalk-faint">vs</span> {f.away_team?.name || 'TBD'}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-chalk-muted">
                    {f.scheduled_at ? `${shortDate(f.scheduled_at)} · ${time(f.scheduled_at)}` : 'Not scheduled'}
                    {f.duration_minutes ? ` · ${f.duration_minutes} min` : ''}
                  </div>
                </div>
                <div className="shrink-0">
                  {isDone ? (
                    <span className="numeric text-[15px] text-chalk">{match.side_a_score}–{match.side_b_score}</span>
                  ) : isLive ? (
                    <Link to={`/app/competitions/${competition.id}/fixtures/${f.id}/live`}>
                      <Badge tone="live">Live →</Badge>
                    </Link>
                  ) : isAdmin ? (
                    <Button size="sm" variant="secondary" loading={start.isPending} onClick={() => start.mutate(f.id)}>
                      Start
                    </Button>
                  ) : (
                    <Badge>Upcoming</Badge>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FixtureSettingsSheet({
  competition, pending, onClose, onGenerate,
}: {
  competition: Competition
  pending: boolean
  onClose: () => void
  onGenerate: (settings: FixtureSettingsBody) => void
}) {
  const multiDay = competition.starts_on !== competition.ends_on
  const [matchDurationMinutes, setMatchDurationMinutes] = useState(
    competition.match_duration_minutes != null ? String(competition.match_duration_minutes) : '',
  )
  const [dayStartsAt, setDayStartsAt] = useState(competition.day_starts_at ?? '16:00')
  const [dayEndsAt, setDayEndsAt] = useState(competition.day_ends_at ?? '')
  const [twoSessions, setTwoSessions] = useState(!!competition.evening_starts_at)
  const [eveningStartsAt, setEveningStartsAt] = useState(competition.evening_starts_at ?? '19:00')
  const [eveningEndsAt, setEveningEndsAt] = useState(competition.evening_ends_at ?? '')
  const [matchesPerDay, setMatchesPerDay] = useState(
    competition.matches_per_day != null ? String(competition.matches_per_day) : '',
  )
  const [concurrentMatches, setConcurrentMatches] = useState(String(competition.concurrent_matches || 1))
  const [breakBetween, setBreakBetween] = useState(String(competition.break_between_matches_minutes ?? 5))
  const [halves, setHalves] = useState(competition.split_into_halves)
  const [halftimeBreak, setHalftimeBreak] = useState(String(competition.halftime_break_minutes ?? 5))

  const halfLength = matchDurationMinutes ? Math.floor(Number(matchDurationMinutes) / 2) : null

  return (
    <Sheet open onClose={onClose} title="Fixture settings">
      <div className="space-y-5">
        <Field label="Minutes per match" hint="Leave blank to work it out from the times below.">
          <Input
            type="number"
            min={1}
            max={180}
            placeholder="Auto"
            value={matchDurationMinutes}
            onChange={(e) => setMatchDurationMinutes(e.target.value)}
          />
        </Field>

        <Card className="py-2.5">
          <Toggle
            label="Split into halves"
            description={halfLength ? `${halfLength} min each half, with a break between` : 'Two halves with a break between'}
            checked={halves}
            onChange={setHalves}
          />
          {halves && (
            <div className="mt-3">
              <Field label="Halftime break">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={halftimeBreak}
                  onChange={(e) => setHalftimeBreak(e.target.value)}
                />
              </Field>
            </div>
          )}
        </Card>

        <Field label="Break between matches" hint="Time to clear the pitch before the next kickoff.">
          <Input
            type="number"
            min={0}
            max={120}
            value={breakBetween}
            onChange={(e) => setBreakBetween(e.target.value)}
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>{twoSessions ? 'Morning' : 'Daily window'}</SectionTitle>
            {!twoSessions && (
              <button className="text-[13px] text-volt-400" onClick={() => setTwoSessions(true)}>
                + Add evening session
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Input type="time" value={dayStartsAt} onChange={(e) => setDayStartsAt(e.target.value)} />
            </Field>
            <Field label="Finish" hint="Optional">
              <Input type="time" value={dayEndsAt} onChange={(e) => setDayEndsAt(e.target.value)} />
            </Field>
          </div>
        </div>

        {twoSessions && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>Evening</SectionTitle>
              <button className="text-[13px] text-chalk-faint hover:text-chalk" onClick={() => setTwoSessions(false)}>
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">
                <Input type="time" value={eveningStartsAt} onChange={(e) => setEveningStartsAt(e.target.value)} />
              </Field>
              <Field label="Finish" hint="Optional">
                <Input type="time" value={eveningEndsAt} onChange={(e) => setEveningEndsAt(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {multiDay && (
          <Field label="Matches per day" hint="Leave blank to fit as many as the window allows.">
            <Input
              type="number"
              min={1}
              max={200}
              placeholder="Auto"
              value={matchesPerDay}
              onChange={(e) => setMatchesPerDay(e.target.value)}
            />
          </Field>
        )}

        <Field label="Matches at once" hint="More than one pitch? Set how many kick off together.">
          <Input
            type="number"
            min={1}
            max={20}
            value={concurrentMatches}
            onChange={(e) => setConcurrentMatches(e.target.value)}
          />
        </Field>

        <p className="text-[12.5px] leading-relaxed text-chalk-faint">
          These times are a plan to get things moving — once a match kicks off, it runs on its
          own real start and finish, not this schedule.
        </p>

        <Button
          fullWidth
          loading={pending}
          onClick={() => onGenerate({
            match_duration_minutes: matchDurationMinutes ? Number(matchDurationMinutes) : null,
            day_starts_at: dayStartsAt || null,
            day_ends_at: dayEndsAt || null,
            evening_starts_at: twoSessions ? (eveningStartsAt || null) : null,
            evening_ends_at: twoSessions ? (eveningEndsAt || null) : null,
            matches_per_day: matchesPerDay ? Number(matchesPerDay) : null,
            concurrent_matches: Number(concurrentMatches) || 1,
            break_between_matches_minutes: Number(breakBetween) || 0,
            split_into_halves: halves,
            halftime_break_minutes: halves ? (Number(halftimeBreak) || 0) : null,
          })}
        >
          {competition.status === 'scheduled' ? 'Re-generate fixtures' : 'Generate fixtures'}
        </Button>
      </div>
    </Sheet>
  )
}

/* --- Standings ----------------------------------------------------------------- */

function StandingsTab({ competitionId }: { competitionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['competition-standings', competitionId],
    queryFn: async () => (await api.get<StandingsRow[]>(`competitions/${competitionId}/standings`)).data,
  })

  if (isLoading) return <Skeleton className="h-48" />
  const rows = data ?? []

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-pitch-700 text-left text-[11px] uppercase tracking-wider text-chalk-muted">
            <th className="px-3 py-2.5">Team</th>
            <th className="px-2 py-2.5 text-center">P</th>
            <th className="px-2 py-2.5 text-center">W</th>
            <th className="px-2 py-2.5 text-center">D</th>
            <th className="px-2 py-2.5 text-center">L</th>
            <th className="px-2 py-2.5 text-center">GD</th>
            <th className="px-3 py-2.5 text-center">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team_id} className={cn('border-b border-pitch-800 last:border-0', i < 1 && 'bg-volt-400/5')}>
              <td className="px-3 py-2.5 text-chalk">{r.team?.name || 'Unnamed'}</td>
              <td className="numeric px-2 py-2.5 text-center text-chalk-muted">{r.played}</td>
              <td className="numeric px-2 py-2.5 text-center text-chalk-muted">{r.won}</td>
              <td className="numeric px-2 py-2.5 text-center text-chalk-muted">{r.drawn}</td>
              <td className="numeric px-2 py-2.5 text-center text-chalk-muted">{r.lost}</td>
              <td className="numeric px-2 py-2.5 text-center text-chalk-muted">{r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
              <td className="numeric px-3 py-2.5 text-center font-semibold text-chalk">{r.points}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-chalk-muted">No completed matches yet</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  )
}
