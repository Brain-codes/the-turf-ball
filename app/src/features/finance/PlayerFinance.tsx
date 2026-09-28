import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  RiAddLine, RiArrowLeftLine, RiCloseCircleLine, RiSubtractLine, RiWallet3Line, RiWhatsappLine,
} from '@remixicon/react'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button, Card, ErrorState, Field, Input, PlayerAvatar, SectionTitle, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { FinanceEntry, FinancePlan, FinancePlayerDetail } from '@/types'
import { PLAN_HINT, PLAN_LABEL, formatMoney, niceDate, reminderText, subLine, whatsappLink } from './money'
import { ChoiceGroup, EntrySheet, MoneyInput, PaymentSheet, RenewSheet, VoidSheet, type SheetPlayer } from './sheets'
import { ActivityRow } from './FinanceScreen'
import { useFinanceRefresh, useIsFinanceAdmin } from './hooks'

type SheetName = 'pay' | 'renew' | 'charge' | 'credit' | null

export function PlayerFinanceScreen() {
  const { playerId } = useParams()
  const { activeOrg } = useAuth()
  const isAdmin = useIsFinanceAdmin()
  const [sheet, setSheet] = useState<SheetName>(null)
  const [voiding, setVoiding] = useState<FinanceEntry | null>(null)

  const q = useQuery({
    queryKey: ['finance', activeOrg?.id, 'player', playerId],
    queryFn: async () => (await api.get<FinancePlayerDetail>(`finance/players/${playerId}`)).data,
    enabled: !!activeOrg && isAdmin && !!playerId,
  })

  if (!isAdmin) return <Navigate to="/app" replace />
  if (q.isLoading) return <div className="space-y-4 px-5 pt-6"><Skeleton className="h-28" /><Skeleton className="h-48" /></div>
  if (q.error || !q.data) {
    return <ErrorState message={q.error instanceof ApiError ? q.error.message : 'We couldn’t load this player.'} onRetry={() => q.refetch()} />
  }

  const d = q.data
  const currency = d.settings.currency
  const sheetPlayer: SheetPlayer = { id: d.player.id, display_name: d.player.display_name, balance: d.balance, game_fee: d.game_fee, monthly_fee: d.monthly_fee }
  const owes = d.balance > 0
  const reminder = reminderText(
    { display_name: d.player.display_name, plan: d.plan, balance: d.balance, sub_state: d.sub_state, sub_days: d.sub_days, sub_ends_on: d.sub_ends_on, monthly_fee: d.monthly_fee },
    activeOrg?.name ?? 'the group',
    currency,
  )

  return (
    <div className="pb-10">
      <div className="px-5 pt-5">
        <Link to="/app/finance" className="inline-flex h-11 items-center gap-1.5 text-[14px] text-chalk-muted hover:text-chalk">
          <RiArrowLeftLine className="h-4.5 w-4.5" /> Money
        </Link>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-5">
        {/* Who, and where they stand */}
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <PlayerAvatar name={d.player.display_name} photoUrl={d.player.photo_url} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl">{d.player.display_name}</h1>
              <p className="text-[14px] text-chalk-muted">
                {PLAN_LABEL[d.plan]}
                {d.plan === 'monthly' && ` · ${subLine(d.sub_state, d.sub_days, d.sub_ends_on)}`}
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-end justify-between gap-4 border-t border-pitch-700 pt-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-muted">
                {owes ? 'Owes' : d.balance < 0 ? 'In credit' : 'Balance'}
              </div>
              <div className={cn('numeric mt-1 text-4xl leading-none', owes ? 'text-card-yellow' : d.balance < 0 ? 'text-volt-400' : 'text-chalk')}>
                {formatMoney(Math.abs(d.balance), currency)}
              </div>
            </div>
            <div className="text-right text-[13px] leading-relaxed text-chalk-muted">
              <div>Charged <span className="numeric text-chalk">{formatMoney(d.charged, currency)}</span></div>
              <div>Paid <span className="numeric text-chalk">{formatMoney(d.paid, currency)}</span></div>
              {d.credited > 0 && <div>Taken off <span className="numeric text-chalk">{formatMoney(d.credited, currency)}</span></div>}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button size="lg" onClick={() => setSheet('pay')}><RiWallet3Line className="h-5 w-5" /> Record payment</Button>
            <Button size="lg" variant="secondary" onClick={() => setSheet('renew')}>
              <RiAddLine className="h-5 w-5" /> {d.plan === 'monthly' ? 'Renew month' : 'Pay monthly'}
            </Button>
            <a
              href={whatsappLink(d.player.phone, reminder)}
              target="_blank"
              rel="noreferrer"
              className="flex h-13 items-center justify-center gap-2 rounded-xl border border-pitch-700 bg-pitch-800 text-[15px] text-chalk hover:border-pitch-600"
            >
              <RiWhatsappLine className="h-5 w-5 text-[#25D366]" /> Remind
            </a>
            <div className="grid grid-cols-2 gap-2.5">
              <Button size="lg" variant="secondary" aria-label="Add a charge" onClick={() => setSheet('charge')}><RiAddLine className="h-5 w-5" /></Button>
              <Button size="lg" variant="secondary" aria-label="Take something off" onClick={() => setSheet('credit')}><RiSubtractLine className="h-5 w-5" /></Button>
            </div>
          </div>
          {!d.player.phone && (
            <p className="mt-3 text-[13px] text-chalk-faint">
              Add their phone number below and Remind opens their chat directly. Without it, you pick them in WhatsApp.
            </p>
          )}
        </Card>

        <PlanEditor detail={d} />

        <section>
          <SectionTitle>History</SectionTitle>
          {d.entries.length === 0 ? (
            <p className="text-[14px] text-chalk-muted">Nothing recorded for {d.player.display_name} yet.</p>
          ) : (
            <Card className="divide-y divide-pitch-700 p-0">
              {d.entries.map((e) => (
                <div key={e.id} className="flex items-center">
                  <div className="min-w-0 flex-1">
                    <ActivityRow entry={{ ...e, description: e.description ?? (e.sessions?.title || null) }} currency={currency} showPlayer={false} />
                  </div>
                  {!e.voided_at && (
                    <button
                      onClick={() => setVoiding(e)}
                      aria-label="Cancel this entry"
                      className="mr-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-chalk-faint hover:bg-pitch-800 hover:text-card-red"
                    >
                      <RiCloseCircleLine className="h-5 w-5" />
                    </button>
                  )}
                </div>
              ))}
            </Card>
          )}
        </section>

        {d.subscriptions.length > 0 && (
          <section>
            <SectionTitle>Months paid for</SectionTitle>
            <Card className="divide-y divide-pitch-700 p-0">
              {d.subscriptions.map((s) => (
                <div key={s.id} className={cn('flex items-center justify-between px-4 py-3 text-[14px]', s.voided_at && 'opacity-50')}>
                  <span className={cn(s.voided_at && 'line-through')}>{niceDate(s.starts_on)} – {niceDate(s.ends_on)}</span>
                  <span className="numeric text-chalk-muted">{s.voided_at ? 'Cancelled' : formatMoney(s.amount, currency)}</span>
                </div>
              ))}
            </Card>
          </section>
        )}
      </div>

      <PaymentSheet open={sheet === 'pay'} onClose={() => setSheet(null)} player={sheetPlayer} currency={currency} />
      <RenewSheet open={sheet === 'renew'} onClose={() => setSheet(null)} player={sheetPlayer} currency={currency} lastEndsOn={d.sub_ends_on} today={d.today} />
      <EntrySheet open={sheet === 'charge'} onClose={() => setSheet(null)} player={sheetPlayer} currency={currency} kind="charge" />
      <EntrySheet open={sheet === 'credit'} onClose={() => setSheet(null)} player={sheetPlayer} currency={currency} kind="credit" />
      <VoidSheet
        open={!!voiding}
        onClose={() => setVoiding(null)}
        entryId={voiding?.id ?? null}
        summary={voiding ? `${voiding.description ?? (voiding.kind === 'payment' ? 'Payment' : 'Charge')} · ${formatMoney(voiding.amount, currency)} · ${niceDate(voiding.entry_date)}${voiding.source === 'subscription' && voiding.kind === 'charge' ? '. This also cancels the month, and any game fees it covered come back.' : ''}` : ''}
      />
    </div>
  )
}

function PlanEditor({ detail }: { detail: FinancePlayerDetail }) {
  const refresh = useFinanceRefresh()
  const currency = detail.settings.currency
  const [plan, setPlan] = useState<FinancePlan>(detail.plan)
  const [phone, setPhone] = useState(detail.player.phone ?? '')
  const [monthly, setMonthly] = useState(detail.custom_monthly_fee != null ? String(detail.custom_monthly_fee) : '')
  const [game, setGame] = useState(detail.custom_game_fee != null ? String(detail.custom_game_fee) : '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPlan(detail.plan)
    setPhone(detail.player.phone ?? '')
    setMonthly(detail.custom_monthly_fee != null ? String(detail.custom_monthly_fee) : '')
    setGame(detail.custom_game_fee != null ? String(detail.custom_game_fee) : '')
  }, [detail])

  const dirty =
    plan !== detail.plan ||
    phone !== (detail.player.phone ?? '') ||
    monthly !== (detail.custom_monthly_fee != null ? String(detail.custom_monthly_fee) : '') ||
    game !== (detail.custom_game_fee != null ? String(detail.custom_game_fee) : '')

  const save = useMutation({
    mutationFn: () =>
      api.patch(`finance/players/${detail.player.id}`, {
        plan,
        phone: phone.trim() || null,
        monthly_fee: monthly === '' ? null : Number(monthly),
        game_fee: game === '' ? null : Number(game),
      }),
    onSuccess: () => {
      refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  return (
    <section>
      <SectionTitle>How they pay</SectionTitle>
      <Card className="space-y-5">
        <ChoiceGroup label="Plan">
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
            {(['monthly', 'per_game', 'exempt'] as FinancePlan[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={plan === p}
                onClick={() => setPlan(p)}
                className={cn(
                  'min-h-20 cursor-pointer rounded-xl border px-3.5 py-3 text-left transition-colors',
                  plan === p ? 'border-volt-400 bg-volt-400/10' : 'border-pitch-700 bg-pitch-800 hover:border-pitch-600',
                )}
              >
                <div className={cn('text-[15px] font-medium', plan === p ? 'text-volt-400' : 'text-chalk')}>{PLAN_LABEL[p]}</div>
                <div className="mt-1 text-[12.5px] leading-snug text-chalk-muted">{PLAN_HINT[p]}</div>
              </button>
            ))}
          </div>
        </ChoiceGroup>
        {plan !== detail.plan && (
          <p className="text-[13px] text-chalk-muted">Changes apply from the next session. What they already owe stays as it is.</p>
        )}

        <Field label="Phone (for WhatsApp reminders)" hint="Only admins can see this.">
          <Input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Their monthly fee" hint={`Blank = group fee (${formatMoney(detail.settings.monthly_fee, currency)})`}>
            <MoneyInput value={monthly} onChange={setMonthly} currency={currency} />
          </Field>
          <Field label="Their game fee" hint={`Blank = group fee (${formatMoney(detail.settings.game_fee, currency)})`}>
            <MoneyInput value={game} onChange={setGame} currency={currency} />
          </Field>
        </div>

        {save.error && <p role="alert" className="text-[14px] text-card-red">{save.error instanceof ApiError ? save.error.message : 'That didn’t save.'}</p>}
        <Button fullWidth size="lg" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          {saved ? 'Saved' : 'Save changes'}
        </Button>
      </Card>
    </section>
  )
}
