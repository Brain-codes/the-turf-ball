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
 * This screen deliberately renders outside the app shell: no tab bar, no side
 * rail, nothing competing for the thumb.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { Button, PlayerAvatar, Skeleton } from '@/components/ui'
import { AnimatePresence, GoalBurst, UndoToast, motion } from '@/components/motion'
import { enqueue, flush, newClientKey, pendingCount, startAutoFlush } from '@/lib/offlineQueue'
import { cn } from '@/lib/cn'
import type { Match, MatchPlayer, Player, Session } from '@/types'

type Action = 'goal' | 'yellow_card' | 'red_card' | 'own_goal'

/** A player tagged with the side they are on for this match. */
type SidedPlayer = Player & { __side?: 'a' | 'b' }

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

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-void p-5">
        <Skeleton className="h-12" />
        <Skeleton className="mt-4 h-40" />
      </div>
    )
  }

  if (!session) return null

  const presentPlayers = (session.attendance ?? [])
    .filter((a) => a.status === 'present' && a.players)
    .map((a) => a.players!)

  return (
    <div className="flex min-h-dvh flex-col bg-void">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-pitch-700 bg-void/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => navigate(`/app/sessions/${id}`)}
          className="tap-target -ml-2 flex items-center px-2 text-[14px] text-chalk-muted"
        >
          ← Exit
        </button>
        <span className="flex-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-chalk-muted">
          Match Day
        </span>
        <span className="w-14 text-right">
          {offline ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-card-yellow">
              Offline
            </span>
          ) : queued > 0 ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-chalk-muted">
              {queued} syncing
            </span>
          ) : null}
        </span>
      </header>

      {offline && (
        <div className="border-b border-card-yellow/30 bg-card-yellow/10 px-4 py-2 text-center text-[13px] text-card-yellow">
          No signal — keep recording, everything saves when you're back.
        </div>
      )}

      {activeMatch ? (
        <LiveMatch
          match={activeMatch}
          sessionId={session.id}
          onFinished={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onQueueChange={setQueued}
        />
      ) : (
        <TeamPicker
          sessionId={session.id}
          players={presentPlayers}
          matchNumber={(session.matches?.length ?? 0) + 1}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['session', id] })}
          onEndSession={async () => {
            await flush()
            await api.post(`sessions/${id}/complete`)
            queryClient.invalidateQueries()
            navigate(`/app/sessions/${id}`)
          }}
          previousMatches={session.matches ?? []}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Picking teams                                                               */
/* -------------------------------------------------------------------------- */

function TeamPicker({
  sessionId,
  players,
  matchNumber,
  onCreated,
  onEndSession,
  previousMatches,
}: {
  sessionId: string
  players: Player[]
  matchNumber: number
  onCreated: () => void
  onEndSession: () => void
  previousMatches: Match[]
}) {
  const [sides, setSides] = useState<Record<string, 'a' | 'b' | null>>({})
  const [error, setError] = useState<string | null>(null)

  const sideA = players.filter((p) => sides[p.id] === 'a')
  const sideB = players.filter((p) => sides[p.id] === 'b')

  /** Alternate down the list — fastest way to get two even teams. */
  function autoSplit() {
    const next: Record<string, 'a' | 'b'> = {}
    players.forEach((p, i) => {
      next[p.id] = i % 2 === 0 ? 'a' : 'b'
    })
    setSides(next)
  }

  function cycle(playerId: string) {
    setSides((prev) => ({
      ...prev,
      [playerId]: prev[playerId] === 'a' ? 'b' : prev[playerId] === 'b' ? null : 'a',
    }))
  }

  const create = useMutation({
    mutationFn: async () =>
      api.post<Match>('matches', {
        session_id: sessionId,
        side_a: sideA.map((p) => p.id),
        side_b: sideB.map((p) => p.id),
        goalkeeper_a: sideA.find((p) => p.position === 'GK')?.id,
        goalkeeper_b: sideB.find((p) => p.position === 'GK')?.id,
      }),
    onSuccess: async ({ data }) => {
      await api.post(`matches/${data.id}/start`)
      onCreated()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start the match'),
  })

  return (
    <div className="flex flex-1 flex-col px-4 pb-4 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl">Match {matchNumber}</h1>
        <Button variant="secondary" size="sm" onClick={autoSplit}>
          Auto split
        </Button>
      </div>

      {previousMatches.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {previousMatches.map((m) => (
            <span
              key={m.id}
              className="numeric shrink-0 rounded-lg bg-pitch-800 px-2.5 py-1 text-[13px] text-chalk-muted"
            >
              #{m.sequence} {m.side_a_score}–{m.side_b_score}
            </span>
          ))}
        </div>
      )}

      <p className="mb-3 text-[13.5px] text-chalk-muted">
        Tap once for {sideA.length > 0 || sideB.length > 0 ? 'Blue' : 'Blue'}, twice for Red.
      </p>

      <div className="mb-4 flex-1 space-y-2 overflow-y-auto">
        {players.map((player) => {
          const side = sides[player.id]
          return (
            <button
              key={player.id}
              onClick={() => cycle(player.id)}
              className={cn(
                'tap-target flex w-full items-center gap-3 rounded-xl border px-3.5 text-left transition-colors',
                side === 'a'
                  ? 'border-assist-blue bg-assist-blue/15'
                  : side === 'b'
                    ? 'border-card-red bg-card-red/15'
                    : 'border-pitch-700 bg-pitch-900',
              )}
            >
              <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-chalk">
                {player.display_name}
              </span>
              {side && (
                <span
                  className={cn(
                    'text-[11px] font-bold uppercase tracking-wider',
                    side === 'a' ? 'text-assist-blue' : 'text-card-red',
                  )}
                >
                  {side === 'a' ? 'Blue' : 'Red'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {error && <p className="mb-3 text-center text-[14px] text-card-red">{error}</p>}

      <div className="space-y-2">
        <Button
          size="xl"
          fullWidth
          loading={create.isPending}
          disabled={sideA.length === 0 || sideB.length === 0}
          onClick={() => create.mutate()}
        >
          Kick off — {sideA.length} v {sideB.length}
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
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [scorer, setScorer] = useState<SidedPlayer | null>(null)
  const [score, setScore] = useState({ a: match.side_a_score, b: match.side_b_score })
  const [celebration, setCelebration] = useState<{ scorer: string; assister?: string | null } | null>(null)
  const [undo, setUndo] = useState<{ label: string; eventId: string | null; clientKey: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(true)

  const startedRef = useRef(match.started_at ? new Date(match.started_at).getTime() : Date.now())

  useEffect(() => {
    if (!running) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [running])

  const roster = match.match_players ?? []
  const bySide = (side: 'a' | 'b'): SidedPlayer[] =>
    roster.filter((r) => r.side === side).map((r) => ({ ...r.players!, __side: side }))

  const allPlayers = [...bySide('a'), ...bySide('b')].filter(Boolean)

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
    ) => {
      const clientKey = newClientKey()
      const minute = Math.floor(elapsed / 60)

      setUndo({ label, eventId: null, clientKey })

      try {
        const { data } = await api.post<{ events: { id: string }[]; score?: { side_a_score: number; side_b_score: number } }>(
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
        if (data.score) setScore({ a: data.score.side_a_score, b: data.score.side_b_score })
        setUndo((current) =>
          current?.clientKey === clientKey
            ? { ...current, eventId: data.events?.[0]?.id ?? null }
            : current,
        )
      } catch {
        // Signal dropped. Queue it — the goal is not lost, and the unique
        // client_key means the eventual retry cannot double-count it.
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
      }
    },
    [match.id, elapsed, onQueueChange],
  )

  function handlePlayerTap(player: SidedPlayer) {
    if (action === 'goal') {
      // Optimistic scoreline, so the number moves under the thumb.
      setScore((s) => (player.__side === 'a' ? { ...s, a: s.a + 1 } : { ...s, b: s.b + 1 }))
      setScorer(player)
      return
    }

    if (action === 'own_goal') {
      setScore((s) => (player.__side === 'a' ? { ...s, b: s.b + 1 } : { ...s, a: s.a + 1 }))
      record('own_goal', player.id, null, `Own goal — ${player.display_name}`)
      setAction(null)
      return
    }

    if (action === 'yellow_card' || action === 'red_card') {
      record(action, player.id, null, `${action === 'yellow_card' ? 'Yellow' : 'Red'} — ${player.display_name}`)
      setAction(null)
    }
  }

  function completeGoal(assister: SidedPlayer | null) {
    if (!scorer) return
    record(
      'goal',
      scorer.id,
      assister?.id ?? null,
      assister ? `Goal — ${scorer.display_name} (${assister.display_name})` : `Goal — ${scorer.display_name}`,
    )
    setCelebration({ scorer: scorer.display_name, assister: assister?.display_name })
    setScorer(null)
    setAction(null)
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
        const { data } = await api.get<Match>(`matches/${match.id}`)
        setScore({ a: data.side_a_score, b: data.side_b_score })
      } catch {
        /* If the undo itself fails the event stands; the organizer can fix it
           from the session screen afterwards rather than being blocked here. */
      }
    }
    setUndo(null)
  }

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-1 flex-col">
      {/* Scoreboard */}
      <div className="border-b border-pitch-700 px-4 py-5">
        <div className="flex items-center justify-center gap-5">
          <div className="flex-1 text-right">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-assist-blue">
              {match.side_a_label}
            </div>
            <div className="numeric text-6xl leading-none text-chalk">{score.a}</div>
          </div>

          <button
            onClick={() => setRunning((r) => !r)}
            className="numeric rounded-xl bg-pitch-800 px-3 py-2 text-xl text-chalk-muted"
          >
            {clock}
          </button>

          <div className="flex-1 text-left">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-card-red">
              {match.side_b_label}
            </div>
            <div className="numeric text-6xl leading-none text-chalk">{score.b}</div>
          </div>
        </div>
      </div>

      {/* Selection area */}
      <div className="flex-1 overflow-y-auto p-4">
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
                players={allPlayers.filter((p) => p.id !== scorer.id && p.__side === scorer.__side)}
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
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl">
                  {action === 'goal' ? 'Who scored?' : action === 'own_goal' ? 'Own goal by?' : 'Which player?'}
                </h2>
                <button onClick={() => setAction(null)} className="text-[14px] text-chalk-muted">
                  Cancel
                </button>
              </div>
              <PlayerGrid players={allPlayers} onPick={handlePlayerTap} showSides />
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="py-10 text-center text-[14px] text-chalk-muted">
                Tap an action below when something happens.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action bar — always within thumb reach */}
      {!action && !scorer && (
        <div className="safe-bottom border-t border-pitch-700 bg-pitch-900 p-3">
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

function PlayerGrid({
  players,
  onPick,
  showSides,
}: {
  players: SidedPlayer[]
  onPick: (player: SidedPlayer) => void
  showSides?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {players.map((player) => (
        <button
          key={player.id}
          onClick={() => onPick(player)}
          className={cn(
            'flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 transition-transform active:scale-95',
            showSides && player.__side === 'a'
              ? 'border-assist-blue/50 bg-assist-blue/10'
              : showSides && player.__side === 'b'
                ? 'border-card-red/50 bg-card-red/10'
                : 'border-pitch-700 bg-pitch-800',
          )}
        >
          <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size="sm" />
          <span className="w-full truncate px-1 text-center text-[13px] font-medium text-chalk">
            {player.display_name}
          </span>
        </button>
      ))}
    </div>
  )
}
