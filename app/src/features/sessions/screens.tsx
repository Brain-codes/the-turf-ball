import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input,
  PlayerAvatar, PlayerName, SectionTitle, Select, Skeleton,
} from '@/components/ui'
import { FadeIn, Sheet } from '@/components/motion'
import { cn } from '@/lib/cn'
import { BAND_LABEL, countdown, fullDate, shortDate, time } from '@/lib/format'
import { sessionCounted } from '@/types'
import type { Attendance, MatchEvent, Player, Session, UpcomingSlot } from '@/types'

const EDIT_WINDOW_HOURS = 5

function editWindowOpenFor(session: Pick<Session, 'ended_at'>): boolean {
  if (!session.ended_at) return false
  const hoursSince = (Date.now() - new Date(session.ended_at).getTime()) / 3_600_000
  return hoursSince <= EDIT_WINDOW_HOURS
}

/** "1h 20m" / "45m" — short duration for delay/overtime/elapsed display. */
function formatMins(totalMinutes: number): string {
  const mins = Math.round(Math.abs(totalMinutes))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const EVENT_LABEL: Record<string, string> = {
  goal: 'Goal', own_goal: 'Own goal', assist: 'Assist',
  yellow_card: 'Yellow card', red_card: 'Red card',
  clean_sheet: 'Clean sheet', save: 'Save', motm: 'Man of the match',
}

/* -------------------------------------------------------------------------- */
/* Session list                                                                */
/* -------------------------------------------------------------------------- */

/** Ticks every 30s so the "next session" countdown stays live without a refetch. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function SessionsScreen() {
  const { activeOrg } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const now = useNow()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sessions', activeOrg?.id],
    queryFn: async () => (await api.get<Session[]>('sessions')).data,
    enabled: !!activeOrg,
    refetchInterval: 60_000,
  })

  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  const approve = useMutation({
    mutationFn: async (id: string) => api.post(`sessions/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const sessions = data ?? []
  // The scheduler auto-generates the next session ahead of time (HANDOFF.md
  // feature 3), so "next session" is whichever scheduled/live one is soonest.
  const nextSession = sessions
    .filter((s) => s.status === 'scheduled' || s.status === 'live')
    .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime())[0]

  return (
    <div className="pb-8">
      <PageHeader
        title="Sessions"
        action={<Button onClick={() => navigate('/app/sessions/new')}>New</Button>}
      />

      <div className="px-5">
        {nextSession && (
          <Card className="mb-4 border-volt-400/30 bg-volt-400/5">
            <div className="text-[11px] uppercase tracking-wider text-chalk-muted">
              {nextSession.status === 'live' ? 'Live now' : 'Next session'}
            </div>
            <div className="mt-1 text-[17px] font-semibold text-chalk">
              {nextSession.title || fullDate(nextSession.session_date)}
            </div>
            <div key={now} className="mt-0.5 numeric text-[15px] text-volt-400">
              {nextSession.status === 'live' ? 'In progress' : countdown(nextSession.kickoff_at)}
            </div>
            <Link
              to={nextSession.status === 'live' ? `/app/sessions/${nextSession.id}/live` : `/app/sessions/${nextSession.id}`}
              className="mt-2 inline-block text-[13px] text-volt-400"
            >
              {nextSession.status === 'live' ? 'Rejoin →' : 'View →'}
            </Link>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon="📅"
            title="No sessions yet"
            description="A session is one match day — who turned up, and the games you played."
            action={<Button onClick={() => navigate('/app/sessions/new')}>Start your first session</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {sessions.map((session) => {
              const flagged = !!session.flagged_inactive_at
              const counted = sessionCounted(session)
              const cancelled = session.status === 'cancelled'
              return (
                <Card
                  key={session.id}
                  className={cn('transition-colors hover:border-pitch-600', cancelled && 'opacity-50')}
                >
                  <Link
                    to={session.status === 'live' ? `/app/sessions/${session.id}/live` : `/app/sessions/${session.id}`}
                    className="block"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] text-chalk">
                            {session.title || shortDate(session.session_date)}
                          </span>
                          {session.status === 'live' && <Badge tone="live">Live</Badge>}
                          {session.status === 'scheduled' && <Badge>Upcoming</Badge>}
                          {cancelled && <Badge>Cancelled</Badge>}
                          {flagged && (
                            <Badge tone="warn">{counted ? 'Approved' : 'No activity recorded'}</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-[13px] text-chalk-muted">
                          {fullDate(session.session_date)} · {time(session.kickoff_at)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        {(session.matches ?? []).map((m) => (
                          <span
                            key={m.id}
                            className="numeric rounded-lg bg-pitch-800 px-2 py-1 text-[13px] text-chalk-muted"
                          >
                            {m.side_a_score}–{m.side_b_score}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                  {flagged && !counted && isAdmin && (
                    <div className="mt-3 flex items-center justify-between border-t border-pitch-700 pt-3">
                      <p className="text-[12.5px] text-chalk-muted">
                        No one was marked present and no matches were recorded — excluded from totals.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={approve.isPending}
                        onClick={(e) => { e.preventDefault(); approve.mutate(session.id) }}
                      >
                        Approve anyway
                      </Button>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Create a session                                                            */
/* -------------------------------------------------------------------------- */

export function NewSessionScreen() {
  const navigate = useNavigate()
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [showCustom, setShowCustom] = useState(false)

  // The regular fixtures, resolved to real upcoming dates. Booking the usual
  // Sunday should be one tap, not a date picker.
  const { data: upcoming, isLoading: loadingSlots } = useQuery({
    queryKey: ['upcoming-slots', activeOrg?.id],
    queryFn: async () =>
      (await api.get<UpcomingSlot[]>(`organizations/${activeOrg!.id}/slots/upcoming`)).data,
    enabled: !!activeOrg,
  })

  const [form, setForm] = useState(() => {
    const now = new Date()
    return {
      date: now.toISOString().slice(0, 10),
      time: (activeOrg?.default_kickoff ?? '17:00').slice(0, 5),
      title: '',
      venue: activeOrg?.venue ?? '',
    }
  })

  const create = useMutation({
    mutationFn: async (payload: {
      kickoff_at: string
      title?: string | null
      venue?: string | null
      slot_id?: string
    }) => api.post<Session>('sessions', payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['upcoming-slots'] })
      navigate(`/app/sessions/${data.id}`, { replace: true })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create the session'),
  })

  // A pickup game with no regular slot and no plan — kick off happens right
  // now, so this skips session detail entirely and drops straight into the
  // live "who's here?" screen, same as a scheduled session going live.
  const startNow = useMutation({
    mutationFn: async () =>
      api.post<Session>('sessions', {
        kickoff_at: new Date().toISOString(),
        venue: activeOrg?.venue || undefined,
      }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      navigate(`/app/sessions/${data.id}/live`, { replace: true })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start a session'),
  })

  const bookable = (upcoming ?? []).filter((slot) => !slot.already_scheduled)

  return (
    <div className="pb-8">
      <PageHeader title="New session" subtitle="Set up a match day" />

      <FadeIn className="space-y-6 px-5">
        <Button
          size="xl"
          fullWidth
          loading={startNow.isPending}
          onClick={() => startNow.mutate()}
        >
          ⚡ Start a session now
        </Button>

        {loadingSlots ? (
          <Skeleton className="h-40" />
        ) : bookable.length > 0 ? (
          <div>
            <SectionTitle>Coming up</SectionTitle>
            <div className="space-y-2">
              {bookable.slice(0, 6).map((slot) => (
                <button
                  key={`${slot.slot_id}-${slot.occurs_at}`}
                  disabled={create.isPending}
                  onClick={() =>
                    create.mutate({ kickoff_at: slot.occurs_at, slot_id: slot.slot_id })
                  }
                  className="flex w-full items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-900 p-4 text-left transition-colors hover:border-volt-400/60 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-chalk">
                      {slot.display_label}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-chalk-muted">
                      {shortDate(slot.occurs_at)} · {time(slot.occurs_at)}
                      {slot.venue && ` · ${slot.venue}`}
                    </span>
                  </span>
                  <span className="text-chalk-muted">→</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Card>
            <p className="text-[13.5px] leading-relaxed text-chalk-muted">
              You have no regular session times set up yet. Add them in{' '}
              <Link to="/app/settings/schedule" className="text-volt-400">
                Settings → Schedule
              </Link>{' '}
              and booking becomes one tap — or just pick a date and time below.
            </p>
          </Card>
        )}

        {error && <p className="text-[14px] text-card-red">{error}</p>}

        {showCustom ? (
          <div className="space-y-4">
            <SectionTitle>One-off session</SectionTitle>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </Field>
              <Field label="Kick off">
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Name it" hint="Optional">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Friday friendly"
              />
            </Field>

            <Field label="Where">
              <Input
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
                placeholder="XYZ Football Arena"
              />
            </Field>

            <Button
              size="lg"
              fullWidth
              loading={create.isPending}
              onClick={() =>
                create.mutate({
                  kickoff_at: new Date(`${form.date}T${form.time}`).toISOString(),
                  title: form.title || null,
                  venue: form.venue || null,
                })
              }
            >
              Create session
            </Button>
          </div>
        ) : (
          <Button variant="secondary" fullWidth onClick={() => setShowCustom(true)}>
            Pick a different date or time
          </Button>
        )}
      </FadeIn>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Session detail — attendance and team selection                              */
/* -------------------------------------------------------------------------- */

interface SessionDetail extends Session {
  attendance: Attendance[]
  matches: NonNullable<Session['matches']>
}

export function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: session, isLoading, error, refetch } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => (await api.get<SessionDetail>(`sessions/${id}`)).data,
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="space-y-2 px-5 pt-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  if (error) return <ErrorState message={(error as Error).message} onRetry={refetch} />
  if (!session) return null

  const isCompleted = session.status === 'completed'
  const flagged = !!session.flagged_inactive_at
  const editable = isCompleted && editWindowOpenFor(session)

  const delayMins = session.actual_kickoff_at
    ? (new Date(session.actual_kickoff_at).getTime() - new Date(session.kickoff_at).getTime()) / 60_000
    : 0
  const overtimeMins = session.ended_at && session.scheduled_end_at
    ? (new Date(session.ended_at).getTime() - new Date(session.scheduled_end_at).getTime()) / 60_000
    : 0
  const elapsedMins = session.ended_at && session.actual_kickoff_at
    ? (new Date(session.ended_at).getTime() - new Date(session.actual_kickoff_at).getTime()) / 60_000
    : null

  const present = session.attendance.filter((a) => a.status === 'present')

  return (
    <div className="pb-8">
      <div className="px-5 pt-5">
        <button onClick={() => navigate('/app/sessions')} className="text-[14px] text-chalk-muted">
          ← Sessions
        </button>
      </div>

      <PageHeader
        title={session.title || fullDate(session.session_date)}
        subtitle={`${time(session.kickoff_at)}${session.venue ? ` · ${session.venue}` : ''}`}
      />

      <div className="px-5">
        {flagged && (
          <Card className="mb-5 border-card-yellow/30 bg-card-yellow/5">
            <p className="text-[13.5px] leading-relaxed text-chalk">
              No one was marked present and no matches were recorded for this session — it's
              excluded from your totals unless an admin approves it from the Sessions list.
            </p>
          </Card>
        )}

        {/* Short, glanceable sections first — the stuff you're most likely to
            be here for (result, timing, fixing a mistake) shouldn't require
            scrolling past a long attendance list to reach. */}
        {session.matches.length > 0 && (
          <section className="mb-7">
            <SectionTitle>Matches</SectionTitle>
            <div className="space-y-2">
              {session.matches.map((match) => (
                <Card key={match.id} className="flex items-center gap-3">
                  <span className="flex-1 text-[14px] text-chalk">Match #{match.sequence}</span>
                  <span className="numeric text-xl text-chalk">{match.side_a_score} goals</span>
                  {match.side_b_score > 0 && (
                    <span className="numeric text-[13px] text-chalk-faint">
                      ({match.side_b_score} own goal{match.side_b_score === 1 ? '' : 's'})
                    </span>
                  )}
                </Card>
              ))}
            </div>
          </section>
        )}

        {(session.actual_kickoff_at || session.ended_at) && (
          <section className="mb-7">
            <SectionTitle>Timeline</SectionTitle>
            <Card className="space-y-1.5 text-[13.5px]">
              <div className="flex justify-between">
                <span className="text-chalk-muted">Scheduled kick-off</span>
                <span className="text-chalk">{time(session.kickoff_at)}</span>
              </div>
              {session.actual_kickoff_at && (
                <div className="flex justify-between">
                  <span className="text-chalk-muted">Actually started</span>
                  <span className="text-chalk">
                    {time(session.actual_kickoff_at)}
                    {Math.abs(delayMins) >= 1 && (
                      <span className="text-chalk-faint"> ({formatMins(delayMins)} {delayMins > 0 ? 'late' : 'early'})</span>
                    )}
                  </span>
                </div>
              )}
              {session.ended_at && (
                <div className="flex justify-between">
                  <span className="text-chalk-muted">Ended</span>
                  <span className="text-chalk">
                    {time(session.ended_at)}
                    {overtimeMins >= 1 && (
                      <span className="text-chalk-faint"> ({formatMins(overtimeMins)} over)</span>
                    )}
                  </span>
                </div>
              )}
              {elapsedMins !== null && (
                <div className="flex justify-between">
                  <span className="text-chalk-muted">Total time played</span>
                  <span className="numeric text-chalk">{formatMins(elapsedMins)}</span>
                </div>
              )}
            </Card>
          </section>
        )}

        {isCompleted && (
          <section className="mb-7">
            <SectionTitle>Correcting the record</SectionTitle>
            {editable ? (
              <EditEventsPanel
                sessionId={session.id}
                matchId={session.matches[session.matches.length - 1]?.id}
                editCloseAt={new Date(new Date(session.ended_at!).getTime() + EDIT_WINDOW_HOURS * 3_600_000)}
              />
            ) : (
              <p className="text-[13px] text-chalk-faint">
                {session.ended_at
                  ? `The 5-hour window to correct goals, assists and cards closed at ${time(
                      new Date(new Date(session.ended_at).getTime() + EDIT_WINDOW_HOURS * 3_600_000),
                    )}.`
                  : 'Nothing to correct yet.'}
              </p>
            )}
          </section>
        )}

        {present.length > 0 && (
          <section className="mb-7">
            <SectionTitle>Who turned up ({present.length})</SectionTitle>
            <AttendanceList attendance={present} />
          </section>
        )}

        {!isCompleted && (
          <Button size="xl" fullWidth onClick={() => navigate(`/app/sessions/${id}/live`)}>
            {session.status === 'live' ? 'Back to match day' : 'Enter session'}
          </Button>
        )}

        {!isCompleted && present.length === 0 && (
          <p className="mt-2 text-center text-[13px] text-chalk-faint">
            You'll mark who's here as soon as you enter
          </p>
        )}
      </div>
    </div>
  )
}

const ATTENDANCE_PREVIEW_COUNT = 5

/** A squad can be 5 people or 50 — collapsed to a short preview by default. */
function AttendanceList({ attendance }: { attendance: Attendance[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? attendance : attendance.slice(0, ATTENDANCE_PREVIEW_COUNT)
  const hiddenCount = attendance.length - visible.length

  return (
    <div>
      <div className="surface divide-y divide-pitch-700 overflow-hidden">
        {visible.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-3.5 py-3">
            <PlayerAvatar
              name={a.players?.display_name ?? 'Player'}
              photoUrl={a.players?.photo_url}
              size="sm"
            />
            <PlayerName
              name={a.players?.display_name ?? 'Player'}
              whatsappNickname={a.players?.whatsapp_nickname}
              className="flex-1 text-[15px] text-chalk"
            />
            {a.punctuality_band && (
              <Badge tone={a.punctuality_band === 'early' ? 'volt' : a.punctuality_band === 'on_time' ? 'neutral' : 'warn'}>
                {BAND_LABEL[a.punctuality_band]}
              </Badge>
            )}
          </div>
        ))}
      </div>
      {attendance.length > ATTENDANCE_PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 w-full text-center text-[13px] text-chalk-muted underline decoration-chalk-faint/40"
        >
          {expanded ? 'Show fewer' : `View all ${attendance.length} (${hiddenCount} more)`}
        </button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Post-session correction — open for 5 hours after a session ends. Missed a  */
/* goal or assist live? Fix it here. Every change is logged, not silent.      */
/* -------------------------------------------------------------------------- */

/** Types a corrected/added event can actually be. Assist isn't one of them
 *  — an assist only ever exists as part of a goal, never standalone. */
const ADDABLE_TYPES = ['goal', 'own_goal', 'yellow_card', 'red_card'] as const
const CORRECTABLE_TYPES = ['goal', 'own_goal', 'assist', 'yellow_card', 'red_card'] as const

interface GoalPlay {
  goal: MatchEvent
  assist: MatchEvent | null
}

function groupId(e: MatchEvent): string | undefined {
  return (e.metadata as Record<string, unknown> | undefined)?.group_id as string | undefined
}

const PREVIEW_COUNT = 5

function EditEventsPanel({
  sessionId,
  matchId,
  editCloseAt,
}: {
  sessionId: string
  matchId: string | undefined
  editCloseAt: Date
}) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<GoalPlay | null>(null)
  const [editingEvent, setEditingEvent] = useState<MatchEvent | null>(null)
  const [expanded, setExpanded] = useState(false)

  const { data: events, isLoading } = useQuery({
    queryKey: ['session-events', sessionId],
    queryFn: async () => (await api.get<MatchEvent[]>('events', { session_id: sessionId })).data,
  })

  const { data: roster } = useQuery({
    queryKey: ['players'],
    queryFn: async () => (await api.get<Player[]>('players')).data,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['session-events', sessionId] })
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
  }

  const rosterOptions = roster ?? []
  const correctable = (events ?? []).filter((e) =>
    CORRECTABLE_TYPES.includes(e.event_type as typeof CORRECTABLE_TYPES[number]),
  )
  const plays: GoalPlay[] = correctable
    .filter((e) => e.event_type === 'goal')
    .map((goal) => ({
      goal,
      assist: correctable.find((e) => e.event_type === 'assist' && groupId(e) === groupId(goal)) ?? null,
    }))
  const otherEvents = correctable.filter((e) => e.event_type === 'own_goal' || e.event_type === 'yellow_card' || e.event_type === 'red_card')
  const allRows: (GoalPlay | MatchEvent)[] = [...plays, ...otherEvents].sort((a, b) => {
    const aTime = 'goal' in a ? a.goal.created_at : a.created_at
    const bTime = 'goal' in b ? b.goal.created_at : b.created_at
    return aTime.localeCompare(bTime)
  })
  const visibleRows = expanded ? allRows : allRows.slice(0, PREVIEW_COUNT)
  const hiddenCount = allRows.length - visibleRows.length

  return (
    <div>
      <p className="mb-3 text-[13px] text-chalk-faint">
        Open for corrections until {time(editCloseAt)} — missed a goal or assist, or something's wrong?
      </p>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : allRows.length === 0 ? (
        <p className="text-[13px] text-chalk-faint">Nothing recorded yet.</p>
      ) : (
        <div className="surface divide-y divide-pitch-700 overflow-hidden">
          {visibleRows.map((row) =>
            'goal' in row ? (
              <button
                key={row.goal.id}
                onClick={() => setEditingGoal(row)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-pitch-800"
              >
                <span className="text-lg">⚽</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-chalk">
                    <span className="font-medium">{row.goal.players?.display_name ?? 'Unknown'}</span>
                    {row.goal.edited_at && <span className="ml-1.5 text-[11px] text-chalk-faint">(edited)</span>}
                  </span>
                  <span className="block text-[12.5px] text-chalk-muted">
                    {row.assist ? `Assist: ${row.assist.players?.display_name ?? 'Unknown'}` : 'No assist'}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-chalk-faint">Edit ›</span>
              </button>
            ) : (
              <button
                key={row.id}
                onClick={() => setEditingEvent(row)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-pitch-800"
              >
                <span className="text-lg">{row.event_type === 'own_goal' ? '🥅' : row.event_type === 'yellow_card' ? '🟨' : '🟥'}</span>
                <span className="min-w-0 flex-1 text-[14px] text-chalk">
                  <span className="font-medium">{row.players?.display_name ?? 'Unknown'}</span>
                  <span className="text-chalk-muted"> — {EVENT_LABEL[row.event_type]}</span>
                  {row.edited_at && <span className="ml-1.5 text-[11px] text-chalk-faint">(edited)</span>}
                </span>
                <span className="shrink-0 text-[12px] text-chalk-faint">Edit ›</span>
              </button>
            ),
          )}
        </div>
      )}

      {allRows.length > PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 w-full text-center text-[13px] text-chalk-muted underline decoration-chalk-faint/40"
        >
          {expanded ? 'Show fewer' : `View all ${allRows.length} (${hiddenCount} more)`}
        </button>
      )}

      <Button variant="ghost" fullWidth className="mt-3" onClick={() => setAddOpen(true)}>
        + Add something missed
      </Button>

      <AddEventSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        matchId={matchId}
        roster={rosterOptions}
        onDone={invalidate}
      />
      <EditGoalSheet
        play={editingGoal}
        onClose={() => setEditingGoal(null)}
        roster={rosterOptions}
        onDone={invalidate}
      />
      <EditSimpleEventSheet
        event={editingEvent}
        onClose={() => setEditingEvent(null)}
        roster={rosterOptions}
        onDone={invalidate}
      />
    </div>
  )
}

/** Add a goal (with an optional assist right there), own goal, or card — via a modal, not an inline form buried in the page. */
function AddEventSheet({
  open,
  onClose,
  matchId,
  roster,
  onDone,
}: {
  open: boolean
  onClose: () => void
  matchId: string | undefined
  roster: Player[]
  onDone: () => void
}) {
  const [type, setType] = useState<typeof ADDABLE_TYPES[number]>('goal')
  const [playerId, setPlayerId] = useState('')
  const [assisterId, setAssisterId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setType('goal')
    setPlayerId('')
    setAssisterId('')
    setError(null)
  }

  const add = useMutation({
    mutationFn: async () => {
      if (!matchId) throw new Error('No match to record against')
      await api.post('events', {
        match_id: matchId,
        event_type: type,
        player_id: playerId,
        related_player_id: type === 'goal' && assisterId ? assisterId : undefined,
      })
    },
    onSuccess: () => {
      onDone()
      reset()
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add that'),
  })

  return (
    <Sheet open={open} onClose={() => { reset(); onClose() }} title="Add something missed">
      <div className="space-y-3">
        {error && <p className="text-[13px] text-card-red">{error}</p>}

        <Field label="What happened">
          <Select value={type} onChange={(e) => { setType(e.target.value as typeof type); setAssisterId('') }}>
            {ADDABLE_TYPES.map((t) => (
              <option key={t} value={t}>{EVENT_LABEL[t]}</option>
            ))}
          </Select>
        </Field>

        <Field label={type === 'goal' ? 'Who scored' : 'Who'}>
          <Select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">Select a player</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </Select>
        </Field>

        {type === 'goal' && (
          <Field label="Assist (optional)">
            <Select value={assisterId} onChange={(e) => setAssisterId(e.target.value)}>
              <option value="">No assist — solo goal</option>
              {roster.filter((p) => p.id !== playerId).map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Button
          fullWidth
          loading={add.isPending}
          disabled={!playerId || !matchId}
          onClick={() => add.mutate()}
        >
          Add
        </Button>
      </div>
    </Sheet>
  )
}

/**
 * Editing a goal IS how you manage its assist — assign one, change it,
 * remove it — because an assist can never exist apart from the goal it
 * belongs to. Also where you'd reassign who scored, or remove the goal
 * (which takes its assist with it) entirely.
 */
function EditGoalSheet({
  play,
  onClose,
  roster,
  onDone,
}: {
  play: GoalPlay | null
  onClose: () => void
  roster: Player[]
  onDone: () => void
}) {
  const [scorerId, setScorerId] = useState('')
  const [assisterId, setAssisterId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (play) {
      setScorerId(play.goal.player_id)
      setAssisterId(play.assist?.player_id ?? '')
      setError(null)
    }
  }, [play])

  const save = useMutation({
    mutationFn: async () => {
      if (!play) return
      const patch: Record<string, unknown> = {}
      if (scorerId !== play.goal.player_id) patch.player_id = scorerId
      if (assisterId !== (play.assist?.player_id ?? '')) patch.related_player_id = assisterId || null
      if (Object.keys(patch).length === 0) return
      await api.patch(`events/${play.goal.id}`, patch)
    },
    onSuccess: () => { onDone(); onClose() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save that correction'),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!play) return
      await api.del(`events/${play.goal.id}`)
    },
    onSuccess: () => { onDone(); onClose() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not remove that'),
  })

  return (
    <Sheet open={!!play} onClose={onClose} title="Edit goal">
      {play && (
        <div className="space-y-3">
          {error && <p className="text-[13px] text-card-red">{error}</p>}

          <Field label="Who scored">
            <Select value={scorerId} onChange={(e) => setScorerId(e.target.value)}>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Assist">
            <Select value={assisterId} onChange={(e) => setAssisterId(e.target.value)}>
              <option value="">No assist — solo goal</option>
              {roster.filter((p) => p.id !== scorerId).map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </Select>
          </Field>

          <Button fullWidth loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
          <Button
            variant="ghost"
            fullWidth
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove this goal{play.assist ? ' and its assist' : ''}
          </Button>
        </div>
      )}
    </Sheet>
  )
}

/** Own goals and cards — one player, no assist concept, so a much smaller sheet. */
function EditSimpleEventSheet({
  event,
  onClose,
  roster,
  onDone,
}: {
  event: MatchEvent | null
  onClose: () => void
  roster: Player[]
  onDone: () => void
}) {
  const [playerId, setPlayerId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (event) {
      setPlayerId(event.player_id)
      setError(null)
    }
  }, [event])

  const save = useMutation({
    mutationFn: async () => {
      if (!event || playerId === event.player_id) return
      await api.patch(`events/${event.id}`, { player_id: playerId })
    },
    onSuccess: () => { onDone(); onClose() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save that correction'),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!event) return
      await api.del(`events/${event.id}`)
    },
    onSuccess: () => { onDone(); onClose() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not remove that'),
  })

  return (
    <Sheet open={!!event} onClose={onClose} title={event ? EVENT_LABEL[event.event_type] : ''}>
      {event && (
        <div className="space-y-3">
          {error && <p className="text-[13px] text-card-red">{error}</p>}

          <Field label="Who">
            <Select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </Select>
          </Field>

          <Button fullWidth loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
          <Button variant="ghost" fullWidth loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        </div>
      )}
    </Sheet>
  )
}
