import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input,
  PlayerAvatar, SectionTitle, Skeleton,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { BAND_LABEL, fullDate, shortDate, time } from '@/lib/format'
import type { Attendance, Player, Session, UpcomingSlot } from '@/types'

/* -------------------------------------------------------------------------- */
/* Session list                                                                */
/* -------------------------------------------------------------------------- */

export function SessionsScreen() {
  const { activeOrg } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sessions', activeOrg?.id],
    queryFn: async () => (await api.get<Session[]>('sessions')).data,
    enabled: !!activeOrg,
  })

  return (
    <div className="pb-8">
      <PageHeader
        title="Sessions"
        action={<Button onClick={() => navigate('/app/sessions/new')}>New</Button>}
      />

      <div className="px-5">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            icon="📅"
            title="No sessions yet"
            description="A session is one match day — who turned up, and the games you played."
            action={<Button onClick={() => navigate('/app/sessions/new')}>Start your first session</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {(data ?? []).map((session) => (
              <Link
                key={session.id}
                to={session.status === 'live' ? `/app/sessions/${session.id}/live` : `/app/sessions/${session.id}`}
              >
                <Card className="transition-colors hover:border-pitch-600">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] text-chalk">
                          {session.title || shortDate(session.session_date)}
                        </span>
                        {session.status === 'live' && <Badge tone="live">Live</Badge>}
                        {session.status === 'scheduled' && <Badge>Upcoming</Badge>}
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

  const bookable = (upcoming ?? []).filter((slot) => !slot.already_scheduled)

  return (
    <div className="pb-8">
      <PageHeader title="New session" subtitle="Set up a match day" />

      <FadeIn className="space-y-6 px-5">
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
  const queryClient = useQueryClient()
  const { activeOrg } = useAuth()
  const [present, setPresent] = useState<Set<string> | null>(null)

  const { data: session, isLoading, error, refetch } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => (await api.get<SessionDetail>(`sessions/${id}`)).data,
    enabled: !!id,
  })

  const { data: players } = useQuery({
    queryKey: ['players', activeOrg?.id],
    queryFn: async () => (await api.get<Player[]>('players')).data,
    enabled: !!activeOrg,
  })

  // Seed the tick-list from whatever has already been saved.
  const selected = present ?? new Set(
    (session?.attendance ?? []).filter((a) => a.status === 'present').map((a) => a.player_id),
  )

  const saveAttendance = useMutation({
    mutationFn: async (playerIds: Set<string>) =>
      api.post(`sessions/${id}/attendance`, {
        entries: (players ?? []).map((p) => ({
          player_id: p.id,
          status: playerIds.has(p.id) ? 'present' : 'absent',
        })),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id] }),
  })

  const startPlaying = useMutation({
    mutationFn: async () => api.post(`sessions/${id}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] })
      navigate(`/app/sessions/${id}/live`)
    },
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

  function toggle(playerId: string) {
    const next = new Set(selected)
    if (next.has(playerId)) next.delete(playerId)
    else next.add(playerId)
    setPresent(next)
    saveAttendance.mutate(next)
  }

  const attendanceByPlayer = new Map(session.attendance.map((a) => [a.player_id, a]))
  const isCompleted = session.status === 'completed'

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
        {!isCompleted && (
          <section className="mb-7">
            <SectionTitle action={<span className="text-[13px] text-chalk-muted">{selected.size} in</span>}>
              Who turned up
            </SectionTitle>

            {(players ?? []).length === 0 ? (
              <EmptyState
                icon="👥"
                title="No players in your squad"
                description="Add some players first."
                action={<Button onClick={() => navigate('/app/players')}>Add players</Button>}
              />
            ) : (
              <div className="surface divide-y divide-pitch-700 overflow-hidden">
                {(players ?? []).map((player) => {
                  const isIn = selected.has(player.id)
                  const record = attendanceByPlayer.get(player.id)
                  return (
                    <button
                      key={player.id}
                      onClick={() => toggle(player.id)}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-pitch-800"
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[12px] font-bold ${
                          isIn
                            ? 'border-volt-400 bg-volt-400 text-void'
                            : 'border-pitch-600 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[15px] text-chalk">
                        {player.display_name}
                      </span>
                      {isIn && record?.punctuality_band && (
                        <Badge tone={record.punctuality_band === 'early' ? 'volt' : record.punctuality_band === 'on_time' ? 'neutral' : 'warn'}>
                          {BAND_LABEL[record.punctuality_band]}
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {session.matches.length > 0 && (
          <section className="mb-7">
            <SectionTitle>Matches</SectionTitle>
            <div className="space-y-2">
              {session.matches.map((match) => (
                <Card key={match.id} className="flex items-center gap-3">
                  <span className="text-[13px] text-chalk-muted">#{match.sequence}</span>
                  <span className="flex-1 text-[14px] text-chalk">
                    {match.side_a_label} v {match.side_b_label}
                  </span>
                  <span className="numeric text-xl text-chalk">
                    {match.side_a_score}–{match.side_b_score}
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}

        {!isCompleted && (
          <Button
            size="xl"
            fullWidth
            disabled={selected.size < 2}
            loading={startPlaying.isPending}
            onClick={() => startPlaying.mutate()}
          >
            {session.status === 'live' ? 'Back to match day' : 'Start playing'}
          </Button>
        )}

        {selected.size < 2 && !isCompleted && (
          <p className="mt-2 text-center text-[13px] text-chalk-faint">
            Tick at least two players to start
          </p>
        )}
      </div>
    </div>
  )
}
