import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, EmptyState, ErrorState, PlayerAvatar, PlayerName,
  SectionTitle, Skeleton,
} from '@/components/ui'
import { FadeIn, Sheet, motion } from '@/components/motion'
import { points } from '@/lib/format'
import type { Award, Period, PlayerStats } from '@/types'

interface AwardsData {
  period: Period
  awards: Award[]
  provisional_leader: PlayerStats | null
}

export function AwardsScreen() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [closeOpen, setCloseOpen] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['awards', activeOrg?.id],
    queryFn: async () => (await api.get<AwardsData>('awards')).data,
    enabled: !!activeOrg,
  })

  const { data: history } = useQuery({
    queryKey: ['award-history', activeOrg?.id],
    queryFn: async () => (await api.get<Award[]>('awards/history')).data,
    enabled: !!activeOrg,
  })

  if (isLoading) {
    return (
      <div className="px-5 pt-8">
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (error) return <ErrorState message={(error as Error).message} onRetry={refetch} />
  if (!data) return null

  const isOpen = data.period.status === 'open'
  const potm = data.awards.find((a) => a.award_types.code === 'player_of_month')
  const others = data.awards.filter((a) => a.award_types.code !== 'player_of_month')
  const canClose = activeOrg?.role === 'owner'

  return (
    <div className="pb-8">
      <PageHeader title="Awards" subtitle={data.period.label} />

      <div className="px-5">
        {isOpen ? (
          data.provisional_leader ? (
            <FadeIn>
              <div className="surface-raised relative overflow-hidden p-6 text-center">
                <div className="absolute inset-0 opacity-[0.06]" style={{
                  background: 'radial-gradient(circle at 50% 0%, var(--color-volt-400), transparent 70%)',
                }} />
                <Badge tone="volt">Still to play for</Badge>
                <p className="mt-4 text-[13px] uppercase tracking-[0.16em] text-chalk-muted">
                  Currently leading
                </p>
                <PlayerAvatar
                  name={data.provisional_leader.players?.display_name ?? ''}
                  photoUrl={data.provisional_leader.players?.photo_url}
                  size="xl"
                  className="mx-auto mt-4"
                />
                <h2 className="mt-4 text-3xl">{data.provisional_leader.players?.display_name}</h2>
                {data.provisional_leader.players?.whatsapp_nickname &&
                  data.provisional_leader.players.whatsapp_nickname.trim() !==
                    (data.provisional_leader.players?.display_name ?? '').trim() && (
                    <p className="mt-0.5 text-[12px] text-chalk-faint/70">
                      {data.provisional_leader.players.whatsapp_nickname}
                    </p>
                  )}
                <div className="mt-5 flex justify-center gap-8">
                  <Stat label="Goals" value={data.provisional_leader.goals} />
                  <Stat label="Assists" value={data.provisional_leader.assists} />
                  <Stat label="Apps" value={data.provisional_leader.appearances} />
                </div>
                <div className="numeric mt-5 text-5xl text-volt-400">
                  {points(data.provisional_leader.total_points)}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-chalk-muted">points</div>
              </div>

              {canClose && (
                <Card className="mt-4">
                  <h3 className="text-[16px]">Finished this month?</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-muted">
                    Closing {data.period.label} locks in the results and crowns your Player of the
                    Month. Nothing recorded after that will change it.
                  </p>
                  <Button className="mt-4" onClick={() => setCloseOpen(true)}>
                    Close {data.period.label}
                  </Button>
                </Card>
              )}
            </FadeIn>
          ) : (
            <EmptyState
              icon="🏆"
              title="No games played yet"
              description={`Record a session and ${data.period.label}'s race begins.`}
            />
          )
        ) : (
          <>
            {potm && <WinnerCard award={potm} />}

            {others.length > 0 && (
              <section className="mt-7">
                <SectionTitle>Other awards</SectionTitle>
                <div className="space-y-2">
                  {others.map((award) => (
                    <Card key={award.id} className="flex items-center gap-3">
                      <span className="text-2xl">{award.award_types.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] text-chalk">{award.award_types.name}</span>
                        <PlayerName
                          name={award.players.display_name}
                          whatsappNickname={award.players.whatsapp_nickname}
                          className="text-[13px] text-chalk-muted"
                        />
                      </span>
                      <span className="numeric text-xl text-volt-400">{points(award.value)}</span>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {(history?.length ?? 0) > 0 && (
          <section className="mt-8">
            <SectionTitle>Past winners</SectionTitle>
            <div className="space-y-2">
              {(history ?? [])
                .filter((a) => a.award_types.code === 'player_of_month')
                .map((award) => (
                  <Card key={award.id} className="flex items-center gap-3">
                    <span className="text-xl">🏆</span>
                    <PlayerAvatar
                      name={award.players.display_name}
                      photoUrl={award.players.photo_url}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <PlayerName
                        name={award.players.display_name}
                        whatsappNickname={award.players.whatsapp_nickname}
                        className="block text-[15px] text-chalk"
                      />
                      <span className="text-[13px] text-chalk-muted">{award.periods?.label}</span>
                    </span>
                    <span className="numeric text-chalk-muted">{points(award.value)}</span>
                  </Card>
                ))}
            </div>
          </section>
        )}
      </div>

      <ClosePeriodSheet
        open={closeOpen}
        periodId={data.period.id}
        periodLabel={data.period.label}
        onClose={() => setCloseOpen(false)}
        onDone={() => {
          queryClient.invalidateQueries()
          setCloseOpen(false)
        }}
      />
    </div>
  )
}

function WinnerCard({ award }: { award: Award }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="surface-raised relative overflow-hidden p-6 text-center"
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{ background: 'radial-gradient(circle at 50% 0%, var(--color-volt-400), transparent 70%)' }}
      />
      <div className="relative">
        <div className="text-5xl">🏆</div>
        <p className="mt-3 text-[12px] uppercase tracking-[0.2em] text-volt-400">
          Player of the Month
        </p>
        <PlayerAvatar
          name={award.players.display_name}
          photoUrl={award.players.photo_url}
          size="xl"
          className="mx-auto mt-5"
        />
        <h2 className="mt-4 text-3xl">{award.players.display_name}</h2>
        {award.players.whatsapp_nickname && award.players.whatsapp_nickname.trim() !== award.players.display_name.trim() && (
          <p className="mt-0.5 text-[12px] text-chalk-faint/70">{award.players.whatsapp_nickname}</p>
        )}
        <div className="numeric mt-4 text-5xl text-volt-400">{points(award.value)}</div>
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">points</div>
      </div>
    </motion.div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="numeric text-2xl text-chalk">{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider text-chalk-muted">{label}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Closing a month                                                             */
/* -------------------------------------------------------------------------- */

interface PreviewData {
  period: Period
  standings: PlayerStats[]
  winner: PlayerStats | null
  can_close: boolean
  blocked_reason: string | null
}

function ClosePeriodSheet({
  open,
  periodId,
  periodLabel,
  onClose,
  onDone,
}: {
  open: boolean
  periodId: string
  periodLabel: string
  onClose: () => void
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const { data: preview, isLoading } = useQuery({
    queryKey: ['period-preview', periodId],
    queryFn: async () => (await api.get<PreviewData>(`periods/${periodId}/preview-close`)).data,
    enabled: open,
  })

  const close = useMutation({
    mutationFn: async () => api.post(`periods/${periodId}/close`),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not close the month'),
  })

  return (
    <Sheet open={open} onClose={onClose} title={`Close ${periodLabel}`}>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !preview ? null : (
        <div className="space-y-4">
          {preview.winner ? (
            <div className="surface p-4 text-center">
              <p className="text-[11px] uppercase tracking-wider text-chalk-muted">
                Your Player of the Month will be
              </p>
              <PlayerAvatar
                name={preview.winner.players?.display_name ?? ''}
                photoUrl={preview.winner.players?.photo_url}
                size="lg"
                className="mx-auto mt-3"
              />
              <h3 className="mt-3 text-2xl">{preview.winner.players?.display_name}</h3>
              {preview.winner.players?.whatsapp_nickname &&
                preview.winner.players.whatsapp_nickname.trim() !== (preview.winner.players?.display_name ?? '').trim() && (
                  <p className="mt-0.5 text-[12px] text-chalk-faint/70">{preview.winner.players.whatsapp_nickname}</p>
                )}
              <p className="mt-1 text-[13.5px] text-chalk-muted">
                {preview.winner.goals} goals · {preview.winner.assists} assists ·{' '}
                {preview.winner.appearances} appearances
              </p>
              <div className="numeric mt-3 text-3xl text-volt-400">
                {points(preview.winner.total_points)}
              </div>
            </div>
          ) : (
            <p className="text-[14px] text-chalk-muted">
              Nobody has played this month, so there is no winner to crown.
            </p>
          )}

          <div className="rounded-xl border border-card-yellow/30 bg-card-yellow/5 p-3.5">
            <p className="text-[13.5px] leading-relaxed text-chalk">
              Once closed, {periodLabel} is locked. The scoring rules are frozen as they are now, so
              changing them later won't rewrite this result. A new month opens straight away.
            </p>
          </div>

          {preview.blocked_reason && (
            <p className="text-[14px] text-card-red">{preview.blocked_reason}</p>
          )}
          {error && <p className="text-[14px] text-card-red">{error}</p>}

          <Button
            size="lg"
            fullWidth
            disabled={!preview.can_close}
            loading={close.isPending}
            onClick={() => close.mutate()}
          >
            Close {periodLabel} and crown the winner
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose}>
            Not yet
          </Button>
        </div>
      )}
    </Sheet>
  )
}
