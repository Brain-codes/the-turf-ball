import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button, Card, Field, Select, SectionTitle, Skeleton, Toggle } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { FinanceOverview, FinancePlan, FinanceSettings } from '@/types'
import { CURRENCIES, PLAN_HINT, PLAN_LABEL, formatMoney } from './money'
import { ChoiceGroup, MoneyInput } from './sheets'
import { useFinanceRefresh, useIsFinanceAdmin } from './hooks'

/** Settings → Money. The group's owner/admins switch finances on and set fees. */
export function MoneySettings() {
  const { activeOrg, refresh: refreshAuth } = useAuth()
  const isAdmin = useIsFinanceAdmin()
  const refresh = useFinanceRefresh()

  const q = useQuery({
    queryKey: ['finance', activeOrg?.id, 'overview'],
    queryFn: async () => (await api.get<FinanceOverview>('finance/overview')).data,
    enabled: !!activeOrg && isAdmin,
  })

  const [form, setForm] = useState<FinanceSettings | null>(null)
  const [monthly, setMonthly] = useState('')
  const [game, setGame] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (q.data) {
      setForm(q.data.settings)
      setMonthly(q.data.settings.monthly_fee ? String(q.data.settings.monthly_fee) : '')
      setGame(q.data.settings.game_fee ? String(q.data.settings.game_fee) : '')
    }
  }, [q.data])

  const toggle = useMutation({
    mutationFn: (on: boolean) => api.patch('finance/settings', { finance_enabled: on }),
    onSuccess: async () => {
      refresh()
      await refreshAuth()
    },
  })

  const save = useMutation({
    mutationFn: () =>
      api.patch('finance/settings', {
        currency: form!.currency,
        monthly_fee: Number(monthly) || 0,
        game_fee: Number(game) || 0,
        default_plan: form!.default_plan,
        remind_days_before: form!.remind_days_before,
        charge_guests: form!.charge_guests,
      }),
    onSuccess: () => {
      refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  if (!isAdmin) {
    return <Card><p className="text-[14px] text-chalk-muted">Only the group’s owner and admins can see or change money settings.</p></Card>
  }
  if (q.isLoading || !form) return <Skeleton className="h-72" />

  const enabled = q.data?.enabled ?? false
  const currency = form.currency

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Money</SectionTitle>
        <Card>
          <Toggle
            checked={enabled}
            disabled={toggle.isPending}
            onChange={(on) => toggle.mutate(on)}
            label="Track money for this group"
            description={
              enabled
                ? 'On. Only you and other admins can see it. Switching it off hides it but deletes nothing.'
                : 'Keep track of monthly subscriptions, game fees, and who owes what. Only admins ever see it.'
            }
          />
          {toggle.error && <p role="alert" className="mt-2 text-[14px] text-card-red">{toggle.error instanceof ApiError ? toggle.error.message : 'That didn’t save.'}</p>}
          {enabled && (
            <Link to="/app/finance" className="mt-2 inline-flex h-11 items-center text-[14px] font-medium text-volt-400">
              Open the money screen →
            </Link>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Fees</SectionTitle>
        <Card className="space-y-5">
          <Field label="Currency">
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly subscription" hint="e.g. 15,000 a month">
              <MoneyInput value={monthly} onChange={setMonthly} currency={currency} />
            </Field>
            <Field label="Pay as you play, per game" hint="e.g. 3,000 a game">
              <MoneyInput value={game} onChange={setGame} currency={currency} />
            </Field>
          </div>

          <ChoiceGroup label="New players start on">
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
              {(['per_game', 'monthly', 'exempt'] as FinancePlan[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={form.default_plan === p}
                  onClick={() => setForm({ ...form, default_plan: p })}
                  className={cn(
                    'min-h-20 cursor-pointer rounded-xl border px-3.5 py-3 text-left',
                    form.default_plan === p ? 'border-volt-400 bg-volt-400/10' : 'border-pitch-700 bg-pitch-800 hover:border-pitch-600',
                  )}
                >
                  <div className={cn('text-[15px] font-medium', form.default_plan === p ? 'text-volt-400' : 'text-chalk')}>{PLAN_LABEL[p]}</div>
                  <div className="mt-1 text-[12.5px] leading-snug text-chalk-muted">{PLAN_HINT[p]}</div>
                </button>
              ))}
            </div>
          </ChoiceGroup>

          <Field label="Remind me when a month is due in" hint="Players show under “Send a reminder” from this many days before.">
            <Select
              value={form.remind_days_before}
              onChange={(e) => setForm({ ...form, remind_days_before: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 5, 7].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'On the day' : `${n} day${n === 1 ? '' : 's'}`}</option>
              ))}
            </Select>
          </Field>

          <Toggle
            checked={form.charge_guests}
            onChange={(v) => setForm({ ...form, charge_guests: v })}
            label="Charge one-time players the game fee"
            description="Someone added on the day as a one-timer."
          />

          {save.error && <p role="alert" className="text-[14px] text-card-red">{save.error instanceof ApiError ? save.error.message : 'That didn’t save.'}</p>}
          <Button size="lg" fullWidth loading={save.isPending} onClick={() => save.mutate()}>
            {saved ? 'Saved' : 'Save fees'}
          </Button>
        </Card>
      </section>

      <section>
        <SectionTitle>How it works</SectionTitle>
        <Card className="space-y-3 text-[14px] leading-relaxed text-chalk-muted">
          <p>
            <span className="text-chalk">Pay as you play.</span> When you tick a player in at a session, their game fee
            ({formatMoney(Number(game) || 0, currency)}) is added to what they owe. Untick them and it comes off.
          </p>
          <p>
            <span className="text-chalk">Monthly.</span> A month runs from the day they paid. Pay on the 16th, due again
            on the 16th. While it’s active they aren’t charged per game. If it runs out and they still play, the game fee
            is added, and cleared again if you then record the month.
          </p>
          <p>
            <span className="text-chalk">Nothing is deleted.</span> A mistake is cancelled with a reason and stays in
            the history, so the numbers can always be checked.
          </p>
          <p>Switching money on only affects sessions from now on. Past games aren’t charged.</p>
        </Card>
      </section>
    </div>
  )
}
