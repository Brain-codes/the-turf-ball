import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { RiCheckLine } from '@remixicon/react'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button, Card, PlayerAvatar, SectionTitle } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { FinanceOverview, PaymentMethod, SessionFeeRow, SessionFees } from '@/types'
import { METHOD_LABEL, formatMoney } from './money'
import { useFinanceRefresh } from './hooks'

const STATUS_TEXT: Record<SessionFeeRow['status'], string> = {
  paid: 'Paid',
  part_paid: 'Part paid',
  unpaid: 'Not paid',
  covered: 'Monthly, covered',
  free: 'Free',
  no_fee: 'No fee',
}

/**
 * "Collect today's fees" on a session. Everyone ticked in, what this game
 * cost them, and one big button per player to say they've paid. Admins
 * only, and only with money switched on.
 */
export function SessionFeesPanel({ sessionId }: { sessionId: string }) {
  const { activeOrg } = useAuth()
  const show = !!activeOrg?.finance_enabled && (activeOrg.role === 'owner' || activeOrg.role === 'admin')
  const refresh = useFinanceRefresh()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [busy, setBusy] = useState<string | null>(null)

  const fees = useQuery({
    queryKey: ['finance', activeOrg?.id, 'session', sessionId],
    queryFn: async () => (await api.get<SessionFees>(`finance/sessions/${sessionId}`)).data,
    enabled: show,
  })
  const overview = useQuery({
    queryKey: ['finance', activeOrg?.id, 'overview'],
    queryFn: async () => (await api.get<FinanceOverview>('finance/overview')).data,
    enabled: show,
  })
  const currency = overview.data?.settings.currency ?? 'NGN'

  const pay = useMutation({
    mutationFn: async (row: SessionFeeRow) => {
      setBusy(row.player.id)
      await api.post('finance/payments', {
        player_id: row.player.id,
        amount: row.fee - row.paid,
        method,
        session_id: sessionId,
        description: 'Game fee',
      })
    },
    onSettled: async () => {
      await refresh()
      setBusy(null)
    },
  })

  const undo = useMutation({
    mutationFn: async (row: SessionFeeRow) => {
      setBusy(row.player.id)
      for (const id of row.payment_ids) {
        await api.post(`finance/entries/${id}/void`, { reason: 'Undone on the session screen' })
      }
    },
    onSettled: async () => {
      await refresh()
      setBusy(null)
    },
  })

  if (!show || !fees.data || fees.data.players.length === 0) return null
  const { players, total_due, total_paid } = fees.data
  const charged = players.filter((p) => p.fee > 0)

  return (
    <section className="mb-7">
      <SectionTitle>Today’s fees</SectionTitle>
      <Card className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="numeric text-2xl leading-none text-chalk">
            {formatMoney(total_paid, currency)} <span className="text-[15px] text-chalk-muted">of {formatMoney(total_due, currency)}</span>
          </div>
          <div className="mt-1 text-[13px] text-chalk-muted">
            collected from {charged.filter((p) => p.status === 'paid').length} of {charged.length} paying today
          </div>
        </div>
        <div role="radiogroup" aria-label="They paid by" className="flex gap-2">
          {(['cash', 'transfer'] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={cn(
                'h-10 cursor-pointer rounded-full border px-4 text-[14px]',
                method === m ? 'border-volt-400 bg-volt-400/15 text-volt-400' : 'border-pitch-700 text-chalk-muted',
              )}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-2.5 md:grid-cols-2">
        {players.map((row) => {
          const owing = row.status === 'unpaid' || row.status === 'part_paid'
          return (
            <div
              key={row.player.id}
              className={cn(
                'flex min-h-16 items-center gap-3 rounded-xl border px-3.5 py-2.5',
                row.status === 'paid' ? 'border-volt-400/40 bg-volt-400/5' : 'border-pitch-700 bg-pitch-900',
              )}
            >
              <PlayerAvatar name={row.player.display_name} photoUrl={row.player.photo_url} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] text-chalk">{row.player.display_name}</div>
                <div className={cn('text-[12.5px]', owing ? 'text-card-yellow' : row.status === 'paid' ? 'text-volt-400' : 'text-chalk-muted')}>
                  {STATUS_TEXT[row.status]}
                  {row.fee > 0 && ` · ${formatMoney(row.fee, currency)}`}
                </div>
              </div>
              {owing && (
                <Button size="md" loading={busy === row.player.id} disabled={!!busy} onClick={() => pay.mutate(row)} className="min-w-28">
                  Paid {formatMoney(row.fee - row.paid, currency)}
                </Button>
              )}
              {row.status === 'paid' && row.payment_ids.length > 0 && (
                <button
                  onClick={() => undo.mutate(row)}
                  disabled={!!busy}
                  className="flex h-11 cursor-pointer items-center gap-1 rounded-lg px-3 text-[13px] text-chalk-muted hover:bg-pitch-800 hover:text-chalk"
                >
                  <RiCheckLine className="h-4 w-4 text-volt-400" /> Undo
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
