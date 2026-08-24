/**
 * MATCH DAY MODE — the most important screen in the product. SPEC.md §7.4.
 *
 * Design constraints, all of which come from the same place: the organizer is
 * standing beside a pitch, outdoors, in sunlight, holding a phone in one hand,
 * watching a game they cannot look away from for long.
 *
 *   - A goal takes three taps. Nothing takes more.
 *   - Every target is at least 56px.
 *   - No modals stacked on modals, no keyboard, no scrolling to reach an action.
 *   - Every write is optimistic and undoable for five seconds.
 *   - Losing signal must not lose a goal.
 *
 * Rebuilt (session 4) — dropped team selection entirely. Real grassroots
 * five-a-side kickabouts don't split into a fixed Blue vs Red before a ball
 * is kicked; the organizer just wants attendance and a scoreboard. Every
 * present player now goes on one roster (side_a; side_b stays empty — the
 * schema keeps the concept for later, the UI doesn't ask about it). The
 * scoreline is replaced by a small running leaderboard of who's contributed
 * what this session. Attendance is marked one tap at a time, each write
 * carrying the exact moment of that tap as `arrived_at` — not a single
 * batch timestamp applied to everyone at once, which would make a 20-name
 * list all "arrive" within the same second and blur real punctuality.
 *
 * This screen deliberately renders outside the app shell: no tab bar, no
 * side rail, nothing competing for the thumb.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { Button, Input, PlayerAvatar, PlayerName, Skeleton } from '@/components/ui'
import { AnimatePresence, GoalBurst, Stagger, StaggerItem, UndoToast, motion } from '@/components/motion'
import { enqueue, flush, newClientKey, pendingCount, startAutoFlush } from '@/lib/offlineQueue'
import { cn } from '@/lib/cn'
import type { Match, MatchEvent, MatchPlayer, Player, Session } from '@/types'
import { useAuth } from '@/features/auth/AuthProvider'

type Action = 'goal' | 'yellow_card' | 'red_card' | 'own_goal'

interface SessionDetail extends Omit<Session, 'attendance' | 'matches'> {
  attendance: { player_id: string; status: string; players?: Player }[]
  matches: (Match & { match_players?: MatchPlayer[] })[]
}

export function MatchDayScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [offline, setOffline] = useState(!navigator.onLine)
  const [queued, setQueued] = useState(0)

  const { data: session, isLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => (await api.get<SessionDetail>(`sessions/${id}`)).data,
    enabled: !!id,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    const stop = startAutoFlush(setQueued)
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    pendingCount().then(setQueued)
    return () => {
      stop()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const activeMatch = useMemo(
    () => session?.matches?.find((m) => m.status === 'live' || m.status === 'pending') ?? null,
    [session],
  )

  const [editingEvents, setEditingEvents] = useState(false)

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-void p-5">
        <Skeleton className="h-12" />
        <Skeleton className="mt-4 h-40" />
      </div>
    )
  }

  if (!session) return null

  // Attendance now lives inside the live view, first — a session that hasn't
  // been marked live yet (i.e. is still 'scheduled', including sessions the
  // scheduler created automatically) opens straight into "who came?" rather
  // than the old session-detail screen. Confirming attendance kicks the
  // match off immediately — no team picker in between.
  const needsAttendance = session.status === 'scheduled'

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <header className="shrink-0 flex items-center gap-3 border-b border-pitch-700 bg-void/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => navigate(`/app/sessions/${id}`)}
          className="tap-target -ml-2 flex items-center px-2 text-[14px] text-chalk-muted"
        >
          ← Exit
        </button>
        <span className="flex-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-chalk-muted">
          Match Day
        </span>
        <span className="flex w-14 shrink-0 items-center justify-end gap-2">
          {offline ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-card-yellow">
              Offline
            </span>
          ) : queued > 0 ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-chalk-muted">
              {queued} syncing
            </span>
          ) : null}
          {activeMatch && (
            <button
              onClick={() => setEditingEvents(true)}
              aria-label="Edit recorded goals, assists and cards"
              className="tap-target -mr-2 flex items-center px-2 text-[13px] font-semibold text-chalk-muted"
            >
              Edit
            </button>
          )}
        </span>
      </header>

      {offline && (
        <div className="shrink-0 border-b border-card-yellow/30 bg-card-yellow/10 px-4 py-2 text-center text-[13px] text-card-yellow">
          No signal — keep recording, everything saves when you're back.
        </div>
      )}

      {session.status === 'live' && session.awaiting_confirmation && (
        <StillGoingPrompt
          sessionId={session.id}
          onKeepGoing={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onEnd={async () => {
            await flush()
            await api.post(`sessions/${id}/complete`)
            queryClient.invalidateQueries()
            navigate(`/app/sessions/${id}`)
          }}
        />
      )}

      {session.status === 'paused' ? (
        <SessionPausedStep
          sessionId={session.id}
          pausedAt={session.paused_at ?? null}
          onResumed={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onEndSession={async () => {
            await flush()
            await api.post(`sessions/${id}/complete`)
            queryClient.invalidateQueries()
            navigate(`/app/sessions/${id}`)
          }}
        />
      ) : needsAttendance ? (
        <AttendanceStep
          sessionId={session.id}
          existingAttendance={session.attendance ?? []}
          matchNumber={(session.matches?.length ?? 0) + 1}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
        />
      ) : activeMatch ? (
        <LiveMatch
          match={activeMatch}
          sessionId={session.id}
          onFinished={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onQueueChange={setQueued}
        />
      ) : session.matches && session.matches.length > 0 ? (
        // A session is one continuous activity — full time doesn't end it,
        // it just pauses it. Resume the same match rather than starting a
        // new one, so the clock and goal totals keep going instead of
        // resetting to zero.
        <MatchPausedStep
          match={session.matches[session.matches.length - 1]}
          onResumed={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onEndSession={async () => {
            await flush()
            await api.post(`sessions/${id}/complete`)
            queryClient.invalidateQueries()
            navigate(`/app/sessions/${id}`)
          }}
        />
      ) : (
        // Fallback — a live session with no match yet at all (shouldn't
        // normally happen since `needsAttendance` covers the first-ever
        // start, but kept in case of old data).
        <AttendanceStep
          sessionId={session.id}
          existingAttendance={session.attendance ?? []}
          matchNumber={1}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onEndSession={async () => {
            await flush()
            await api.post(`sessions/${id}/complete`)
            queryClient.invalidateQueries()
            navigate(`/app/sessions/${id}`)
          }}
        />
      )}

      {editingEvents && activeMatch && (
        <EventsEditorSheet
          match={activeMatch}
          onClose={() => setEditingEvents(false)}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Edit sheet — reachable from the header. Fixes a mis-tap after the fact:    */
/* wrong scorer, wrong assister, or an event that shouldn't have been logged  */
/* at all. Shares the same ['match-events', match.id] query key as LiveMatch  */
/* so the stat board and activity feed there pick up changes immediately.    */
/* -------------------------------------------------------------------------- */

function EventsEditorSheet({
  match,
  onClose,
}: {
  match: Match & { match_players?: MatchPlayer[] }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [reassigning, setReassigning] = useState<MatchEvent | null>(null)
  const [editingAssist, setEditingAssist] = useState<MatchEvent | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<MatchEvent | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: matchEvents, isLoading } = useQuery({
    queryKey: ['match-events', match.id],
    queryFn: async () => (await api.get<MatchEvent[]>('events', { match_id: match.id })).data,
  })
  // Assists ride along with their goal (edited via that goal's "Assist"
  // button below) rather than as their own row — patching an assist event
  // directly wouldn't keep the paired goal's related_player_id in sync.
  const events = (matchEvents ?? [])
    .filter((e) => e.event_type !== 'assist')
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const rosterPlayers: Player[] = (match.match_players ?? [])
    .filter((r) => r.players)
    .map((r) => ({ ...r.players!, id: r.player_id }))

  function assisterName(event: MatchEvent) {
    if (!event.related_player_id) return null
    return rosterPlayers.find((p) => p.id === event.related_player_id)?.display_name ?? 'Unknown'
  }

  async function deleteEvent(event: MatchEvent) {
    setBusyId(event.id)
    setError(null)
    try {
      await api.del(`events/${event.id}`)
      await queryClient.invalidateQueries({ queryKey: ['match-events', match.id] })
      setConfirmingDelete(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that — try again')
    } finally {
      setBusyId(null)
    }
  }

  async function reassign(event: MatchEvent, player: Player) {
    setBusyId(event.id)
    setError(null)
    try {
      await api.patch(`events/${event.id}`, { player_id: player.id })
      await queryClient.invalidateQueries({ queryKey: ['match-events', match.id] })
      setReassigning(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that — try again')
    } finally {
      setBusyId(null)
    }
  }

  async function setAssist(event: MatchEvent, player: Player | null) {
    setBusyId(event.id)
    setError(null)
    try {
      await api.patch(`events/${event.id}`, { related_player_id: player?.id ?? null })
      await queryClient.invalidateQueries({ queryKey: ['match-events', match.id] })
      setEditingAssist(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that — try again')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-pitch-700 bg-pitch-900 p-4">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-lg text-chalk">Edit this match</h3>
          <button onClick={onClose} className="text-[14px] text-chalk-muted">
            Done
          </button>
        </div>
        <p className="mb-3 shrink-0 text-[13px] text-chalk-muted">
          Fix a wrong scorer or remove something that shouldn't have been logged.
        </p>

        {error && (
          <p className="mb-3 shrink-0 rounded-lg border border-card-red/30 bg-card-red/10 px-3 py-2 text-[13px] text-card-red">
            {error}
          </p>
        )}

        {reassigning ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[14px] text-chalk">
                Reassign {EVENT_LABEL[reassigning.event_type] ?? reassigning.event_type}
              </p>
              <button onClick={() => setReassigning(null)} className="text-[13px] text-chalk-muted">
                Cancel
              </button>
            </div>
            <PlayerGrid
              players={rosterPlayers.filter((p) => p.id !== reassigning.player_id)}
              onPick={(p) => reassign(reassigning, p)}
            />
          </div>
        ) : editingAssist ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[14px] text-chalk">
                Who assisted {editingAssist.players?.display_name ?? 'this goal'}?
              </p>
              <button onClick={() => setEditingAssist(null)} className="text-[13px] text-chalk-muted">
                Cancel
              </button>
            </div>
            {editingAssist.related_player_id && (
              <button
                disabled={busyId === editingAssist.id}
                onClick={() => setAssist(editingAssist, null)}
                className="tap-target mb-3 w-full rounded-xl border border-pitch-700 bg-pitch-900 text-[15px] font-semibold text-chalk disabled:opacity-50"
              >
                No assist — remove it
              </button>
            )}
            <PlayerGrid
              players={rosterPlayers.filter((p) => p.id !== editingAssist.player_id)}
              onPick={(p) => setAssist(editingAssist, p)}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {isLoading && <Skeleton className="h-20" />}
            {!isLoading && events.length === 0 && (
              <p className="py-4 text-center text-[13.5px] text-chalk-faint">Nothing recorded yet</p>
            )}
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-800 px-3.5 py-2.5"
              >
                <span className="text-[16px]">{EVENT_ICON[e.event_type] ?? '•'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-chalk">
                    {e.players?.display_name ?? 'Unknown'}
                  </p>
                  <p className="text-[12px] text-chalk-muted">
                    {EVENT_LABEL[e.event_type] ?? e.event_type}
                    {e.minute !== null ? ` · ${e.minute}'` : ''}
                    {e.event_type === 'goal' && (
                      <> · {assisterName(e) ? `assist: ${assisterName(e)}` : 'no assist'}</>
                    )}
                  </p>
                </div>
                {confirmingDelete?.id === e.id ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      disabled={busyId === e.id}
                      onClick={() => deleteEvent(e)}
                      className="tap-target rounded-lg border border-card-red px-2.5 text-[12px] font-medium text-card-red disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(null)}
                      className="tap-target rounded-lg border border-pitch-600 px-2.5 text-[12px] font-medium text-chalk-muted"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    {e.event_type === 'goal' && rosterPlayers.length > 1 && (
                      <button
                        disabled={busyId === e.id}
                        onClick={() => setEditingAssist(e)}
                        className="tap-target rounded-lg border border-pitch-600 px-2.5 text-[12px] font-medium text-chalk-muted disabled:opacity-50"
                      >
                        Assist
                      </button>
                    )}
                    {e.event_type !== 'own_goal' && rosterPlayers.length > 1 && (
                      <button
                        disabled={busyId === e.id}
                        onClick={() => setReassigning(e)}
                        className="tap-target rounded-lg border border-pitch-600 px-2.5 text-[12px] font-medium text-chalk-muted disabled:opacity-50"
                      >
                        Reassign
                      </button>
                    )}
                    <button
                      disabled={busyId === e.id}
                      onClick={() => setConfirmingDelete(e)}
                      className="tap-target rounded-lg border border-card-red/50 px-2.5 text-[12px] font-medium text-card-red disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Attendance — "who came?" — the first thing the live view asks. Tapping a   */
/* player marks them present right then, at that exact moment, no team split. */
/* -------------------------------------------------------------------------- */

function AttendanceStep({
  sessionId,
  existingAttendance,
  matchNumber,
  onDone,
  onEndSession,
}: {
  sessionId: string
  existingAttendance: { player_id: string; status: string }[]
  matchNumber: number
  onDone: () => void
  onEndSession?: () => void
}) {
  const { activeOrg } = useAuth()
  const [present, setPresent] = useState<Set<string>>(
    new Set(existingAttendance.filter((a) => a.status === 'present').map((a) => a.player_id)),
  )
  const [search, setSearch] = useState('')
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [newName, setNewName] = useState('')
  const [newOneTime, setNewOneTime] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraPlayers, setExtraPlayers] = useState<Player[]>([])
  const [starting, setStarting] = useState(false)

  const { data: rosterPlayers, isLoading } = useQuery({
    queryKey: ['players', activeOrg?.id],
    queryFn: async () => (await api.get<Player[]>('players')).data,
    enabled: !!activeOrg,
  })

  const players = [...(rosterPlayers ?? []), ...extraPlayers]
  const filtered = players.filter((p) =>
    p.display_name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  /** Marks the tap moment itself as arrived_at — not a batch time applied later. */
  async function markPresent(playerId: string) {
    const arrived_at = new Date().toISOString()
    setPresent((prev) => new Set(prev).add(playerId))
    try {
      await api.post(`sessions/${sessionId}/attendance`, {
        entries: [{ player_id: playerId, status: 'present', arrived_at }],
      })
    } catch {
      // Non-blocking — worst case the organizer re-taps and it's caught by
      // upsert idempotency. The tap already reflected locally either way.
    }
  }

  async function markAbsent(playerId: string) {
    setPresent((prev) => {
      const next = new Set(prev)
      next.delete(playerId)
      return next
    })
    try {
      await api.post(`sessions/${sessionId}/attendance`, {
        entries: [{ player_id: playerId, status: 'absent' }],
      })
    } catch {
      /* best-effort, see markPresent */
    }
  }

  function toggle(playerId: string) {
    if (present.has(playerId)) markAbsent(playerId)
    else markPresent(playerId)
  }

  const addPlayer = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Player>('players', {
        first_name: newName.trim(),
        // One-timers land as 'guest' — they show up today and are markable
        // for attendance/goals like anyone else, but stay out of the
        // regular squad list and league totals (see Settings > league table).
        status: newOneTime ? 'guest' : undefined,
      })
      return data
    },
    onSuccess: async (player) => {
      setExtraPlayers((prev) => [...prev, player])
      setNewName('')
      setNewOneTime(false)
      setAddingPlayer(false)
      await markPresent(player.id)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add that player'),
  })

  const start = useMutation({
    mutationFn: async () => {
      setStarting(true)
      await api.post(`sessions/${sessionId}/start`)
      const { data: match } = await api.post<Match>('matches', {
        session_id: sessionId,
        side_a: Array.from(present),
      })
      await api.post(`matches/${match.id}/start`)
    },
    onSuccess: onDone,
    onError: (err) => {
      setStarting(false)
      setError(err instanceof ApiError ? err.message : 'Could not start the match')
    },
  })

  if (isLoading) {
    return (
      <div className="flex-1 p-5">
        <Skeleton className="h-40" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-5">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl">Who's here?</h1>
        {matchNumber > 1 && (
          <span className="text-[12px] text-chalk-muted">Match {matchNumber}</span>
        )}
      </div>
      <p className="mb-3 text-[13.5px] text-chalk-muted">
        Tap a player the moment you see them — that's their arrival time.
      </p>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search players"
        className="mb-3"
      />

      <div className="mb-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {filtered.map((player) => {
          const isIn = present.has(player.id)
          return (
            <button
              key={player.id}
              onClick={() => toggle(player.id)}
              className={cn(
                'tap-target flex w-full items-center gap-3 rounded-xl border px-3.5 text-left transition-colors',
                isIn ? 'border-volt-400 bg-volt-400/10' : 'border-pitch-700 bg-pitch-900',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[12px] font-bold',
                  isIn ? 'border-volt-400 bg-volt-400 text-void' : 'border-pitch-600 text-transparent',
                )}
              >
                ✓
              </span>
              <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size="sm" />
              <PlayerName
                name={player.display_name}
                whatsappNickname={player.whatsapp_nickname}
                className="flex-1 text-[15px] text-chalk"
              />
            </button>
          )
        })}

        {addingPlayer ? (
          <div className="space-y-2 rounded-xl border border-pitch-700 bg-pitch-900 p-2.5">
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Their name"
                autoFocus
                className="flex-1"
              />
              <Button
                size="sm"
                loading={addPlayer.isPending}
                disabled={newName.trim().length < 1}
                onClick={() => addPlayer.mutate()}
              >
                Add
              </Button>
              <button
                onClick={() => { setAddingPlayer(false); setNewName(''); setNewOneTime(false) }}
                className="text-[13px] text-chalk-muted"
              >
                Cancel
              </button>
            </div>
            <OneTimeToggle checked={newOneTime} onChange={setNewOneTime} />
          </div>
        ) : (
          <button
            onClick={() => setAddingPlayer(true)}
            className="tap-target flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-pitch-600 text-[14px] text-chalk-muted"
          >
            + Someone not on the list just arrived
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-center text-[14px] text-card-red">{error}</p>}

      <div className="space-y-2">
        <Button
          size="xl"
          fullWidth
          disabled={present.size < 2}
          loading={start.isPending || starting}
          onClick={() => start.mutate()}
        >
          Start — {present.size} in
        </Button>
        {present.size < 2 && (
          <p className="text-center text-[13px] text-chalk-faint">
            Tap at least two players to start
          </p>
        )}
        {onEndSession && (
          <Button variant="ghost" fullWidth onClick={onEndSession}>
            End session
          </Button>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The session has gone quiet past its scheduled end — nobody force-closes   */
/* it while the organizer is still on this screen, but it does check in.     */
/* -------------------------------------------------------------------------- */

function StillGoingPrompt({
  sessionId,
  onKeepGoing,
  onEnd,
}: {
  sessionId: string
  onKeepGoing: () => void
  onEnd: () => void
}) {
  const [busy, setBusy] = useState<'keep' | 'end' | null>(null)

  async function keepGoing() {
    setBusy('keep')
    try {
      await api.post(`sessions/${sessionId}/keep-alive`)
      onKeepGoing()
    } finally {
      setBusy(null)
    }
  }

  async function end() {
    setBusy('end')
    try {
      await onEnd()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="shrink-0 border-b border-volt-400/30 bg-volt-400/10 px-4 py-3">
      <p className="mb-2 text-center text-[13.5px] text-chalk">
        This session's gone quiet past its scheduled end time — still going?
      </p>
      <div className="flex gap-2">
        <Button size="sm" fullWidth loading={busy === 'keep'} disabled={busy === 'end'} onClick={keepGoing}>
          Still going
        </Button>
        <Button
          size="sm"
          variant="ghost"
          fullWidth
          loading={busy === 'end'}
          disabled={busy === 'keep'}
          onClick={end}
        >
          End session
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Paused for inactivity — the session went 20 minutes without anything      */
/* being recorded, so it stopped being live. Nothing was finalised: the      */
/* match, its roster and its events are all exactly where they were. The     */
/* only two ways out are the organizer's, not the system's.                  */
/* -------------------------------------------------------------------------- */

function SessionPausedStep({
  sessionId,
  pausedAt,
  onResumed,
  onEndSession,
}: {
  sessionId: string
  pausedAt: string | null
  onResumed: () => void
  onEndSession: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)

  const resume = useMutation({
    mutationFn: async () => {
      await api.post(`sessions/${sessionId}/resume`)
    },
    onSuccess: onResumed,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not resume the session'),
  })

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="mb-1 text-2xl text-chalk">Session paused</h1>
        <p className="text-[14px] text-chalk-muted">
          Nothing was recorded for 20 minutes, so this session was paused
          {pausedAt ? ` at ${pausedTime(pausedAt)}` : ''}. It hasn't been ended — everything
          recorded is still here.
        </p>
      </div>

      {error && <p className="text-[14px] text-card-red">{error}</p>}

      <div className="w-full space-y-2">
        <Button size="xl" fullWidth loading={resume.isPending} onClick={() => resume.mutate()}>
          Resume session
        </Button>
        <Button
          variant="ghost"
          fullWidth
          loading={ending}
          onClick={async () => {
            setEnding(true)
            try {
              await onEndSession()
            } finally {
              setEnding(false)
            }
          }}
        >
          End session
        </Button>
      </div>
    </div>
  )
}

function pausedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function MatchPausedStep({
  match,
  onResumed,
  onEndSession,
}: {
  match: Match
  onResumed: () => void
  onEndSession: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const resume = useMutation({
    mutationFn: async () => {
      await api.post(`matches/${match.id}/resume`)
    },
    onSuccess: onResumed,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not resume the match'),
  })

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="mb-1 text-2xl text-chalk">Full time</h1>
        <p className="text-[14px] text-chalk-muted">
          Keep recording against this session, or wrap up for the day.
        </p>
      </div>

      {error && <p className="text-[14px] text-card-red">{error}</p>}

      <div className="w-full space-y-2">
        <Button size="xl" fullWidth loading={resume.isPending} onClick={() => resume.mutate()}>
          Resume
        </Button>
        <Button variant="ghost" fullWidth onClick={onEndSession}>
          End session
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The live match — the fast recorder                                          */
/* -------------------------------------------------------------------------- */

interface PlayerStatRow {
  playerId: string
  name: string
  whatsappNickname: string | null
  photoUrl: string | null
  goals: number
  assists: number
  ownGoals: number
  yellowCards: number
  redCards: number
}

const EVENT_ICON: Record<string, string> = {
  goal: '⚽',
  assist: '🅰️',
  own_goal: '🥅',
  yellow_card: '🟨',
  red_card: '🟥',
}

const EVENT_LABEL: Record<string, string> = {
  goal: 'Goal',
  assist: 'Assist',
  own_goal: 'Own goal',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
}

function LiveMatch({
  match,
  sessionId,
  onFinished,
  onQueueChange,
}: {
  match: Match & { match_players?: MatchPlayer[] }
  sessionId: string
  onFinished: () => void
  onQueueChange: (n: number) => void
}) {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [scorer, setScorer] = useState<Player | null>(null)
  const [search, setSearch] = useState('')
  const [celebration, setCelebration] = useState<{ scorer: string; assister?: string | null } | null>(null)
  const [undo, setUndo] = useState<{ label: string; eventId: string | null; clientKey: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(true)
  const [addingLate, setAddingLate] = useState(false)
  const [lateSearch, setLateSearch] = useState('')
  const [addingLateBusy, setAddingLateBusy] = useState(false)
  const [addingLateError, setAddingLateError] = useState<string | null>(null)
  const [lateNewName, setLateNewName] = useState('')
  const [lateOneTime, setLateOneTime] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewingSquad, setViewingSquad] = useState(false)
  const [addedFeedback, setAddedFeedback] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)

  const startedRef = useRef(match.started_at ? new Date(match.started_at).getTime() : Date.now())

  useEffect(() => {
    if (!running) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [running])

  const roster = match.match_players ?? []
  // player_id is the source of truth for identity — the nested `players`
  // object is only for display fields. Trusting players.id here was the
  // reported bug: an incomplete select meant every card carried
  // id: undefined, so recording an event silently sent no real player_id.
  const rosterPlayers: Player[] = roster
    .filter((r) => r.players)
    .map((r) => ({ ...r.players!, id: r.player_id }))

  // The real source of truth for what's happened this match — not a local
  // tally. A client-only counter only ever tracked goals/assists (cards and
  // own goals bumped nothing), so the stat board looked empty even when
  // those events had genuinely recorded. Reading straight from match_events
  // means every event type shows up, survives a refresh, and includes real
  // player names for free.
  const { data: matchEvents, refetch: refetchEvents } = useQuery({
    queryKey: ['match-events', match.id],
    queryFn: async () => (await api.get<MatchEvent[]>('events', { match_id: match.id })).data,
    refetchInterval: 15_000,
  })
  const events = matchEvents ?? []

  const statRows = useMemo(() => {
    const rows = new Map<string, PlayerStatRow>()
    const ensure = (playerId: string, name: string, whatsappNickname: string | null, photoUrl: string | null) => {
      if (!rows.has(playerId)) {
        rows.set(playerId, { playerId, name, whatsappNickname, photoUrl, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0 })
      }
      return rows.get(playerId)!
    }
    for (const e of events) {
      const name = e.players?.display_name ?? 'Unknown'
      const whatsappNickname = e.players?.whatsapp_nickname ?? null
      const photoUrl = e.players?.photo_url ?? null
      const row = ensure(e.player_id, name, whatsappNickname, photoUrl)
      if (e.event_type === 'goal') row.goals++
      else if (e.event_type === 'assist') row.assists++
      else if (e.event_type === 'own_goal') row.ownGoals++
      else if (e.event_type === 'yellow_card') row.yellowCards++
      else if (e.event_type === 'red_card') row.redCards++
    }
    return Array.from(rows.values()).sort(
      (a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists),
    )
  }, [events])

  const totals = statRows.reduce(
    (sum, r) => ({
      goals: sum.goals + r.goals,
      assists: sum.assists + r.assists,
      cards: sum.cards + r.yellowCards + r.redCards,
    }),
    { goals: 0, assists: 0, cards: 0 },
  )

  const activity = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  // Everyone in the org, for the latecomer search — filtered to whoever
  // isn't already on the pitch roster.
  const { data: allOrgPlayers } = useQuery({
    queryKey: ['players', activeOrg?.id],
    queryFn: async () => (await api.get<Player[]>('players')).data,
    enabled: !!activeOrg && (addingLate || viewingSquad),
  })
  const rosterIds = new Set(rosterPlayers.map((p) => p.id))
  const absentPlayers = (allOrgPlayers ?? []).filter((p) => !rosterIds.has(p.id))
  const latecomerCandidates = absentPlayers.filter((p) =>
    p.display_name.toLowerCase().includes(lateSearch.trim().toLowerCase()),
  )

  const filteredRoster = rosterPlayers.filter((p) =>
    p.display_name.toLowerCase().includes(search.trim().toLowerCase()),
  )


  /**
   * Record an event. Optimistic by design: the UI updates the instant the tap
   * lands, the write goes out behind it, and a failure falls back to the
   * offline queue rather than an error the organizer has to deal with mid-game.
   */
  const record = useCallback(
    async (
      eventType: string,
      playerId: string,
      relatedPlayerId: string | null,
      label: string,
    ): Promise<boolean> => {
      const clientKey = newClientKey()
      // The clock is real wall time since kickoff, so a match left open
      // overnight can read hundreds of minutes. The server only accepts
      // 0-200, so clamp rather than let a late tap fail validation.
      const minute = Math.min(200, Math.max(0, Math.floor(elapsed / 60)))

      setUndo({ label, eventId: null, clientKey })
      setActionError(null)

      try {
        const { data } = await api.post<{ events: { id: string }[] }>(
          'events',
          {
            match_id: match.id,
            event_type: eventType,
            player_id: playerId,
            related_player_id: relatedPlayerId,
            minute,
            client_key: clientKey,
          },
        )
        setUndo((current) =>
          current?.clientKey === clientKey
            ? { ...current, eventId: data.events?.[0]?.id ?? null }
            : current,
        )
        refetchEvents()
        return true
      } catch (err) {
        // Only a genuine network failure (ApiError status 0, or the browser
        // is offline) belongs in the retry queue. A real response the server
        // rejected — period closed, player not in this match, expired
        // session — will reject identically on every retry, so silently
        // queuing it just hides a goal that will never actually save. That
        // was the reported bug: goals recorded live never showing up later.
        const isNetworkFailure = !navigator.onLine || (err instanceof ApiError && err.status === 0)
        if (!isNetworkFailure) {
          setUndo(null)
          setActionError(err instanceof ApiError ? err.message : 'Could not save that — try again')
          return false
        }

        await enqueue({
          client_key: clientKey,
          match_id: match.id,
          event_type: eventType,
          player_id: playerId,
          related_player_id: relatedPlayerId,
          minute,
          queued_at: Date.now(),
        })
        onQueueChange(await pendingCount())
        // Queued for retry once signal returns — treated as provisionally ok
        // so the leaderboard still reflects what the organizer just saw
        // happen; the offline queue is what makes that promise good.
        return true
      }
    },
    [match.id, elapsed, onQueueChange, refetchEvents],
  )

  function handlePlayerTap(player: Player) {
    if (action === 'goal') {
      setScorer(player)
      return
    }

    if (action === 'own_goal') {
      record('own_goal', player.id, null, `Own goal — ${player.display_name}`)
      setAction(null)
      return
    }

    if (action === 'yellow_card' || action === 'red_card') {
      record(action, player.id, null, `${action === 'yellow_card' ? 'Yellow' : 'Red'} — ${player.display_name}`)
      setAction(null)
    }
  }

  async function completeGoal(assister: Player | null) {
    if (!scorer) return
    const ok = await record(
      'goal',
      scorer.id,
      assister?.id ?? null,
      assister ? `Goal — ${scorer.display_name} (${assister.display_name})` : `Goal — ${scorer.display_name}`,
    )
    if (ok) {
      setCelebration({ scorer: scorer.display_name, assister: assister?.display_name })
    }
    setScorer(null)
    setAction(null)
    setSearch('')
  }

  async function addLatecomer(player: Player) {
    setAddingLateBusy(true)
    setAddingLateError(null)
    try {
      await api.post(`sessions/${sessionId}/attendance`, {
        entries: [{ player_id: player.id, status: 'present', arrived_at: new Date().toISOString() }],
      })
      await api.patch(`matches/${match.id}/roster`, {
        side_a: [...rosterPlayers.map((p) => p.id), player.id],
      })
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      setAddingLate(false)
      setViewingSquad(false)
      setLateSearch('')
      setLateNewName('')
      setLateOneTime(false)
      setAddedFeedback(`${player.display_name} added to the pitch`)
      setTimeout(() => setAddedFeedback((current) => (current === `${player.display_name} added to the pitch` ? null : current)), 2500)
    } catch (err) {
      // Surface the failure instead of silently closing the sheet — the
      // reported bug was a tap that "did nothing": in reality the write was
      // failing and the error was being swallowed.
      setAddingLateError(err instanceof ApiError ? err.message : 'Could not add that player — try again')
    } finally {
      setAddingLateBusy(false)
    }
  }

  /** Undoes a mistaken attendance tap — takes them off the pitch roster and marks them absent. */
  async function removePlayer(player: Player) {
    setAddingLateBusy(true)
    setAddingLateError(null)
    try {
      await api.patch(`matches/${match.id}/roster`, {
        side_a: rosterPlayers.filter((p) => p.id !== player.id).map((p) => p.id),
      })
      await api.post(`sessions/${sessionId}/attendance`, {
        entries: [{ player_id: player.id, status: 'absent' }],
      })
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      setAddedFeedback(`${player.display_name} marked not present`)
      setTimeout(() => setAddedFeedback((current) => (current === `${player.display_name} marked not present` ? null : current)), 2500)
    } catch (err) {
      setAddingLateError(err instanceof ApiError ? err.message : 'Could not update that — try again')
    } finally {
      setAddingLateBusy(false)
    }
  }

  /** Someone not in the squad database at all yet — create them, then add them same as any latecomer. */
  async function createAndAddLatecomer() {
    if (lateNewName.trim().length < 1) return
    setAddingLateBusy(true)
    setAddingLateError(null)
    try {
      const { data: player } = await api.post<Player>('players', {
        first_name: lateNewName.trim(),
        status: lateOneTime ? 'guest' : undefined,
      })
      await addLatecomer(player)
    } catch (err) {
      setAddingLateBusy(false)
      setAddingLateError(err instanceof ApiError ? err.message : 'Could not add that player — try again')
    }
  }

  const finish = useMutation({
    mutationFn: async () => {
      await flush()
      return api.post(`matches/${match.id}/finish`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      onFinished()
    },
  })

  async function performUndo() {
    if (!undo) return
    if (undo.eventId) {
      try {
        await api.del(`events/${undo.eventId}`)
      } catch {
        /* If the undo itself fails the event stands; the organizer can fix it
           from the session screen afterwards rather than being blocked here. */
      }
    }
    setUndo(null)
  }

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {actionError && (
        <div className="shrink-0 border-b border-card-red/30 bg-card-red/10 px-4 py-2 text-center text-[13px] text-card-red">
          {actionError}
        </div>
      )}

      {/* Top bar — clock, headline totals, add player. Full detail lives below. */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-pitch-700 bg-pitch-900/60 px-4 py-3">
        <button
          onClick={() => setRunning((r) => !r)}
          className="numeric shrink-0 rounded-xl bg-pitch-800 px-3 py-2 text-lg text-chalk-muted transition-colors active:bg-pitch-700"
          aria-label={running ? 'Pause clock' : 'Resume clock'}
        >
          {clock}
        </button>

        <div className="flex shrink-0 items-center gap-3.5">
          <span className="text-center leading-none">
            <span className="numeric block text-2xl font-bold text-volt-400">{totals.goals}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-chalk-faint">Goals</span>
          </span>
          <span className="text-center leading-none">
            <span className="numeric block text-2xl font-bold text-chalk">{totals.assists}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-chalk-faint">Assists</span>
          </span>
          <span className="text-center leading-none">
            <span className="numeric block text-2xl font-bold text-card-yellow">{totals.cards}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-chalk-faint">Cards</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setViewingSquad(true)}
            className="tap-target rounded-lg border border-pitch-700 px-2.5 text-[12px] font-medium text-chalk-muted transition-colors active:bg-pitch-800"
          >
            Squad
          </button>
          <button
            onClick={() => setAddingLate(true)}
            className="tap-target rounded-lg border border-pitch-700 px-2.5 text-[12px] font-medium text-chalk-muted transition-colors active:bg-pitch-800"
          >
            + Add player
          </button>
        </div>
      </div>

      {addedFeedback && (
        <div className="shrink-0 border-b border-volt-400/30 bg-volt-400/10 px-4 py-2 text-center text-[13px] text-volt-400">
          {addedFeedback}
        </div>
      )}

      {/* Selection area — the only region that scrolls */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {scorer ? (
            <motion.div
              key="assist"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h2 className="mb-1 text-xl">Who assisted?</h2>
              <p className="mb-4 text-[14px] text-chalk-muted">{scorer.display_name} scored</p>

              <button
                onClick={() => completeGoal(null)}
                className="tap-target mb-3 w-full rounded-xl border border-pitch-700 bg-pitch-900 text-[15px] font-semibold text-chalk"
              >
                No assist — solo goal
              </button>

              <PlayerGrid
                players={rosterPlayers.filter((p) => p.id !== scorer.id)}
                onPick={(p) => completeGoal(p)}
              />
            </motion.div>
          ) : action ? (
            <motion.div
              key="who"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl">
                  {action === 'goal' ? 'Who scored?' : action === 'own_goal' ? 'Own goal by?' : 'Which player?'}
                </h2>
                <button onClick={() => { setAction(null); setSearch('') }} className="text-[14px] text-chalk-muted">
                  Cancel
                </button>
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players"
                className="mb-3"
                autoFocus
              />
              <PlayerGrid players={filteredRoster} onPick={handlePlayerTap} />
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              {statRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <motion.span
                    className="mb-3 text-5xl"
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    ⚽
                  </motion.span>
                  <p className="text-[15px] font-medium text-chalk">Match in progress</p>
                  <p className="mt-1 text-[13.5px] text-chalk-muted">
                    Tap Goal, Yellow, Red or Own goal below the moment it happens.
                  </p>
                  {rosterPlayers.length > 0 && (
                    <p className="mt-4 text-[12.5px] text-chalk-faint">
                      {rosterPlayers.length} player{rosterPlayers.length === 1 ? '' : 's'} on the pitch
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Stat board — a real leaderboard: rank, name, and every stat that applies */}
                  <div>
                    <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-chalk-faint">
                      Stat board
                    </h2>
                    <Stagger className="space-y-2">
                      {statRows.map((r, i) => {
                        const impact = r.goals * 2 + r.assists
                        const topImpact = Math.max(1, statRows[0].goals * 2 + statRows[0].assists)
                        const isLeader = i === 0 && impact > 0
                        return (
                          <StaggerItem key={r.playerId}>
                            <div
                              className={cn(
                                'relative overflow-hidden rounded-xl border p-3',
                                isLeader
                                  ? 'border-volt-400/50 bg-gradient-to-r from-volt-400/15 via-pitch-900 to-pitch-900'
                                  : 'border-pitch-700 bg-pitch-900',
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                    i === 0 ? 'bg-volt-400 text-void'
                                      : i === 1 ? 'bg-chalk-muted/80 text-void'
                                      : i === 2 ? 'bg-amber-700/80 text-void'
                                      : 'bg-pitch-800 text-chalk-faint',
                                  )}
                                >
                                  {i + 1}
                                </span>
                                <PlayerAvatar name={r.name} photoUrl={r.photoUrl} size="sm" />
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
                                    <span className="text-chalk-muted">🅰️ <span className="numeric font-semibold text-chalk">{r.assists}</span></span>
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
                              </div>
                              {impact > 0 && (
                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-pitch-800">
                                  <motion.div
                                    className={cn('h-full rounded-full', isLeader ? 'bg-volt-400' : 'bg-chalk-muted/60')}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.max(8, (impact / topImpact) * 100)}%` }}
                                    transition={{ duration: 0.5, ease: 'easeOut' }}
                                  />
                                </div>
                              )}
                            </div>
                          </StaggerItem>
                        )
                      })}
                    </Stagger>
                  </div>

                  {/* Activity feed — a timeline of exactly what's been recorded */}
                  <div>
                    <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-chalk-faint">
                      Activity
                    </h2>
                    <div className="relative space-y-3 pl-1">
                      {activity.length > 1 && (
                        <div className="absolute bottom-3 left-[13px] top-3 w-px bg-pitch-700" aria-hidden />
                      )}
                      <AnimatePresence initial={false}>
                        {activity.map((e) => (
                          <motion.div
                            key={e.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="relative flex items-start gap-3"
                          >
                            <span
                              className={cn(
                                'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px]',
                                e.event_type === 'goal' ? 'border-volt-400/50 bg-volt-400/15'
                                  : e.event_type === 'red_card' || e.event_type === 'own_goal' ? 'border-card-red/50 bg-card-red/15'
                                  : e.event_type === 'yellow_card' ? 'border-card-yellow/50 bg-card-yellow/15'
                                  : 'border-pitch-600 bg-pitch-800',
                              )}
                            >
                              {EVENT_ICON[e.event_type] ?? '•'}
                            </span>
                            <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pt-0.5">
                              <span className="min-w-0 truncate text-[13.5px] text-chalk">
                                <span className="font-medium">{e.players?.display_name ?? 'Unknown'}</span>
                                {e.players?.whatsapp_nickname &&
                                  e.players.whatsapp_nickname.trim() !== (e.players?.display_name ?? '').trim() && (
                                    <span className="text-[11px] font-normal text-chalk-faint/70">
                                      {' '}
                                      ({e.players.whatsapp_nickname})
                                    </span>
                                  )}
                                <span className="text-chalk-muted"> — {EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                              </span>
                              {e.minute !== null && (
                                <span className="numeric shrink-0 text-[12px] text-chalk-faint">{e.minute}'</span>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action bar — always within thumb reach */}
      {!action && !scorer && (
        <div className="safe-bottom shrink-0 border-t border-pitch-700 bg-pitch-900 p-3">
          <div className="grid grid-cols-4 gap-2">
            <ActionButton label="Goal" icon="⚽" primary onClick={() => setAction('goal')} />
            <ActionButton label="Yellow" icon="🟨" onClick={() => setAction('yellow_card')} />
            <ActionButton label="Red" icon="🟥" onClick={() => setAction('red_card')} />
            <ActionButton label="Own goal" icon="🥅" onClick={() => setAction('own_goal')} />
          </div>
          <Button
            variant="secondary"
            fullWidth
            className="mt-2"
            loading={finish.isPending}
            onClick={() => finish.mutate()}
          >
            Full time
          </Button>
        </div>
      )}

      {addingLate && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60 backdrop-blur-sm">
          <div className="w-full rounded-t-2xl border-t border-pitch-700 bg-pitch-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg text-chalk">Someone just arrived</h3>
              <button
                onClick={() => {
                  setAddingLate(false)
                  setLateSearch('')
                  setLateNewName('')
                  setLateOneTime(false)
                  setAddingLateError(null)
                }}
                className="text-[14px] text-chalk-muted"
              >
                Close
              </button>
            </div>
            {addingLateError && (
              <p className="mb-3 rounded-lg border border-card-red/30 bg-card-red/10 px-3 py-2 text-[13px] text-card-red">
                {addingLateError}
              </p>
            )}
            <Input
              value={lateSearch}
              onChange={(e) => setLateSearch(e.target.value)}
              placeholder="Search the squad"
              className="mb-3"
              autoFocus
            />
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {latecomerCandidates.map((p) => (
                <button
                  key={p.id}
                  disabled={addingLateBusy}
                  onClick={() => addLatecomer(p)}
                  className="tap-target flex w-full items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-800 px-3.5 text-left"
                >
                  <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                  <PlayerName
                    name={p.display_name}
                    whatsappNickname={p.whatsapp_nickname}
                    className="flex-1 text-[15px] text-chalk"
                  />
                </button>
              ))}
              {latecomerCandidates.length === 0 && !lateSearch && (
                <p className="py-4 text-center text-[13.5px] text-chalk-faint">
                  Everyone in the squad is already marked in
                </p>
              )}
            </div>

            {/* Nobody by that name? Create them on the spot, regular or one-time. */}
            <div className="mt-3 space-y-2 border-t border-pitch-700 pt-3">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-chalk-faint">
                Not in the squad list yet
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={lateNewName}
                  onChange={(e) => setLateNewName(e.target.value)}
                  placeholder="Their name"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  loading={addingLateBusy}
                  disabled={lateNewName.trim().length < 1}
                  onClick={createAndAddLatecomer}
                >
                  Add
                </Button>
              </div>
              <OneTimeToggle checked={lateOneTime} onChange={setLateOneTime} />
            </div>
          </div>
        </div>
      )}

      {viewingSquad && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full flex-col rounded-t-2xl border-t border-pitch-700 bg-pitch-900 p-4">
            <div className="mb-3 flex shrink-0 items-center justify-between">
              <h3 className="text-lg text-chalk">Squad</h3>
              <button onClick={() => setViewingSquad(false)} className="text-[14px] text-chalk-muted">
                Close
              </button>
            </div>
            {addingLateError && (
              <p className="mb-3 shrink-0 rounded-lg border border-card-red/30 bg-card-red/10 px-3 py-2 text-[13px] text-card-red">
                {addingLateError}
              </p>
            )}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-chalk-faint">
                  On the pitch — {rosterPlayers.length}
                </p>
                <div className="space-y-2">
                  {rosterPlayers
                    .slice()
                    .sort((a, b) => a.display_name.localeCompare(b.display_name))
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-800 px-3.5 py-2.5"
                      >
                        <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                        <PlayerName
                          name={p.display_name}
                          whatsappNickname={p.whatsapp_nickname}
                          className="flex-1 text-[15px] text-chalk"
                        />
                        {confirmingRemove === p.id ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              disabled={addingLateBusy}
                              onClick={() => { removePlayer(p); setConfirmingRemove(null) }}
                              className="tap-target rounded-lg border border-card-red px-2.5 text-[12px] font-medium text-card-red disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmingRemove(null)}
                              className="tap-target rounded-lg border border-pitch-600 px-2.5 text-[12px] font-medium text-chalk-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={addingLateBusy}
                            onClick={() => setConfirmingRemove(p.id)}
                            className="tap-target shrink-0 rounded-lg border border-card-red/50 px-2.5 text-[12px] font-medium text-card-red disabled:opacity-50"
                          >
                            Not present
                          </button>
                        )}
                      </div>
                    ))}
                  {rosterPlayers.length === 0 && (
                    <p className="py-2 text-center text-[13.5px] text-chalk-faint">Nobody on the pitch yet</p>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-chalk-faint">
                  Not present — {absentPlayers.length}
                </p>
                <div className="space-y-2">
                  {absentPlayers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-800/50 px-3.5 py-2.5"
                    >
                      <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                      <PlayerName
                        name={p.display_name}
                        whatsappNickname={p.whatsapp_nickname}
                        className="flex-1 text-[15px] text-chalk-muted"
                      />
                      <button
                        disabled={addingLateBusy}
                        onClick={() => addLatecomer(p)}
                        className="tap-target shrink-0 rounded-lg border border-volt-400 px-2.5 text-[12px] font-medium text-volt-400 transition-colors active:bg-volt-400/15 disabled:opacity-50"
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                  {absentPlayers.length === 0 && (
                    <p className="py-2 text-center text-[13.5px] text-chalk-faint">Everyone in the squad is here</p>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setViewingSquad(false)
                setAddingLate(true)
              }}
              className="tap-target mt-3 shrink-0 w-full rounded-xl border border-pitch-700 bg-pitch-800 text-[14px] font-medium text-chalk"
            >
              + Add player not in squad
            </button>
          </div>
        </div>
      )}

      <GoalBurst
        show={!!celebration}
        scorer={celebration?.scorer ?? ''}
        assister={celebration?.assister}
        onDone={() => setCelebration(null)}
      />

      <UndoToast
        show={!!undo && !celebration}
        label={undo?.label ?? ''}
        onUndo={performUndo}
        onExpire={() => setUndo(null)}
        liftAboveActionBar={!action && !scorer}
      />
    </div>
  )
}

function ActionButton({
  label,
  icon,
  primary,
  onClick,
}: {
  label: string
  icon: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border transition-transform active:scale-95',
        primary
          ? 'border-volt-400 bg-volt-400/15 text-volt-400'
          : 'border-pitch-700 bg-pitch-800 text-chalk-muted',
      )}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
    </button>
  )
}

/** Distinguishes a squad member from someone who's just dropping in for the day. */
function OneTimeToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left"
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-volt-400 bg-volt-400 text-void' : 'border-pitch-600',
        )}
      >
        {checked && '✓'}
      </span>
      <span className="text-[13px] text-chalk-muted">
        One-time player <span className="text-chalk-faint">— not added to the regular squad</span>
      </span>
    </button>
  )
}

function PlayerGrid({
  players,
  onPick,
}: {
  players: Player[]
  onPick: (player: Player) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {players.map((player) => (
        <button
          key={player.id}
          onClick={() => onPick(player)}
          className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border border-pitch-700 bg-pitch-800 p-2 transition-transform active:scale-95"
        >
          <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size="sm" />
          <span className="w-full truncate px-1 text-center text-[13px] font-medium text-chalk">
            {player.display_name}
          </span>
          {player.whatsapp_nickname && player.whatsapp_nickname.trim() !== player.display_name.trim() && (
            <span className="-mt-1 w-full truncate px-1 text-center text-[10.5px] text-chalk-faint/70">
              {player.whatsapp_nickname}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
