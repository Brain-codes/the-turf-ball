/**
 * Live event logging for one competition fixture. Deliberately a lean sibling
 * of MatchDay.tsx rather than a reuse of that component: MatchDay is built
 * around a whole session (attendance-taking, live team splitting, the
 * offline queue) that a competition fixture doesn't need — the roster is
 * already fixed by the draft. What IS reused, unchanged, is the underlying
 * engine: this posts to the exact same POST /events endpoint that MatchDay
 * does, so scoring, undo, and stats all behave identically either way.
 */

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { Button, ErrorState, PlayerAvatar, PlayerName, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Match, MatchPlayer, Player } from '@/types'

const EVENT_ACTIONS = [
  { type: 'goal', label: 'Goal', icon: '⚽' },
  { type: 'penalty_save', label: 'Pen save', icon: '🧤' },
  { type: 'clean_sheet', label: 'Clean sheet', icon: '🛡️' },
  { type: 'own_goal', label: 'Own goal', icon: '🥅' },
  { type: 'yellow_card', label: 'Yellow', icon: '🟨' },
  { type: 'red_card', label: 'Red', icon: '🟥' },
] as const

export function CompetitionMatchDayScreen() {
  const { id: competitionId, fixtureId } = useParams<{ id: string; fixtureId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: fixture, isLoading: fixtureLoading } = useQuery({
    queryKey: ['competition-fixture', fixtureId],
    queryFn: async () => {
      const list = await api.get<{ id: string; match_id: string | null; home_team?: { name: string | null }; away_team?: { name: string | null } }[]>(
        `competitions/${competitionId}/fixtures`,
      )
      return list.data.find((f) => f.id === fixtureId) ?? null
    },
    enabled: !!competitionId && !!fixtureId,
  })

  const matchId = fixture?.match_id ?? null

  const { data: match, isLoading, error, refetch } = useQuery({
    queryKey: ['match', matchId],
    queryFn: async () => (await api.get<Match & { players: MatchPlayer[] }>(`matches/${matchId}`)).data,
    enabled: !!matchId,
    refetchInterval: 5000,
  })

  const [action, setAction] = useState<typeof EVENT_ACTIONS[number]['type'] | null>(null)
  const [scorer, setScorer] = useState<Player | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const record = useCallback(
    async (eventType: string, playerId: string, relatedPlayerId: string | null) => {
      setActionError(null)
      try {
        await api.post('events', {
          match_id: matchId,
          event_type: eventType,
          player_id: playerId,
          related_player_id: relatedPlayerId,
          client_key: crypto.randomUUID(),
        })
        queryClient.invalidateQueries({ queryKey: ['match', matchId] })
        queryClient.invalidateQueries({ queryKey: ['competition-standings', competitionId] })
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Could not save that — try again')
      }
    },
    [matchId, queryClient, competitionId],
  )

  const finish = useMutation({
    mutationFn: async () => api.post(`matches/${matchId}/finish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competition-fixtures', competitionId] })
      queryClient.invalidateQueries({ queryKey: ['competition-standings', competitionId] })
      navigate(`/app/competitions/${competitionId}`)
    },
  })

  if (fixtureLoading || (matchId && isLoading)) {
    return <div className="px-5 pt-6"><Skeleton className="h-40" /></div>
  }
  if (error || !match) {
    return <div className="px-5 pt-6"><ErrorState message={(error as Error)?.message ?? 'This fixture has not started yet'} onRetry={refetch} /></div>
  }

  const homeSide = match.players.filter((p) => p.side === 'a')
  const awaySide = match.players.filter((p) => p.side === 'b')

  function handleTap(player: Player) {
    if (action === 'goal') { setScorer(player); return }
    if (action !== null) {
      record(action, player.id, null)
      setAction(null)
    }
  }

  async function completeGoal(assister: Player | null) {
    if (!scorer) return
    await record('goal', scorer.id, assister?.id ?? null)
    setFeedback(assister ? `Goal — ${scorer.display_name} (assist: ${assister.display_name})` : `Goal — ${scorer.display_name}`)
    setTimeout(() => setFeedback(null), 2500)
    setScorer(null)
    setAction(null)
  }

  return (
    <div className="min-h-dvh bg-void pb-10">
      <div className="sticky top-0 z-10 border-b border-pitch-700 bg-void/95 px-5 py-4 backdrop-blur-lg">
        <div className="flex items-center justify-between">
          <div className="numeric text-3xl text-chalk">{match.side_a_score}–{match.side_b_score}</div>
          <Button size="sm" variant="secondary" loading={finish.isPending} onClick={() => finish.mutate()}>Finish</Button>
        </div>
        <div className="mt-1 flex justify-between text-[13px] text-chalk-muted">
          <span>{match.side_a_label}</span>
          <span>{match.side_b_label}</span>
        </div>
      </div>

      {feedback && (
        <div className="mx-5 mt-3 rounded-lg bg-volt-400/10 px-3 py-2 text-[13px] text-volt-400">{feedback}</div>
      )}
      {actionError && (
        <div className="mx-5 mt-3 rounded-lg bg-card-red/10 px-3 py-2 text-[13px] text-card-red">{actionError}</div>
      )}

      {scorer ? (
        <div className="px-5 pt-4">
          <p className="mb-3 text-[14px] text-chalk-muted">Who assisted {scorer.display_name}? (Optional)</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => completeGoal(null)}>No assist</Button>
            <Button variant="ghost" onClick={() => { setScorer(null); setAction(null) }}>Cancel</Button>
          </div>
          <div className="mt-3 space-y-1.5">
            {[...homeSide, ...awaySide].filter((p) => p.player_id !== scorer.id).map((p) => (
              <PlayerRow key={p.id} matchPlayer={p} onTap={() => completeGoal(p.players ?? null)} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 px-5 pt-4">
            {EVENT_ACTIONS.map((a) => (
              <button
                key={a.type}
                onClick={() => setAction(action === a.type ? null : a.type)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl py-3 text-[11px] font-medium transition-colors',
                  action === a.type ? 'bg-volt-400 text-void' : 'bg-pitch-800 text-chalk-muted hover:text-chalk',
                )}
              >
                <span className="text-xl leading-none">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>

          {action && (
            <p className="px-5 pt-3 text-[13px] text-chalk-muted">Tap the player who {
              action === 'goal' ? 'scored'
                : action === 'own_goal' ? 'put it in their own net'
                : action === 'penalty_save' ? 'saved the penalty'
                : action === 'clean_sheet' ? 'kept the clean sheet'
                : `got the ${action === 'yellow_card' ? 'yellow' : 'red'}`
            }.</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 px-5">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-chalk-muted">{match.side_a_label}</p>
              <div className="space-y-1.5">
                {homeSide.map((p) => <PlayerRow key={p.id} matchPlayer={p} onTap={() => p.players && handleTap(p.players)} />)}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-chalk-muted">{match.side_b_label}</p>
              <div className="space-y-1.5">
                {awaySide.map((p) => <PlayerRow key={p.id} matchPlayer={p} onTap={() => p.players && handleTap(p.players)} />)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PlayerRow({ matchPlayer, onTap }: { matchPlayer: MatchPlayer; onTap: () => void }) {
  const player = matchPlayer.players
  if (!player) return null
  return (
    <button onClick={onTap} className="flex w-full items-center gap-2 rounded-lg bg-pitch-900 px-2.5 py-2 text-left hover:bg-pitch-800">
      <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size="xs" />
      <PlayerName name={player.display_name} whatsappNickname={player.whatsapp_nickname} className="text-[13px] text-chalk" />
    </button>
  )
}
