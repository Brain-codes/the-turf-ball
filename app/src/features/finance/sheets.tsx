import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { addMonths, format, parseISO } from 'date-fns'
import { api, ApiError } from '@/services/client'
import { Sheet } from '@/components/motion'
import { Button, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PaymentMethod } from '@/types'
import { useFinanceRefresh } from './hooks'
import { METHOD_LABEL, formatMoney, niceDate, suggestedStart } from './money'


const METHODS: PaymentMethod[] = ['cash', 'transfer', 'card', 'other']

/** Big, well-spaced choice buttons: no mis-taps at the pitch. */
export function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div role="radiogroup" aria-label="How they paid" className="grid grid-cols-4 gap-2">
      {METHODS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={cn(
            'h-12 cursor-pointer rounded-xl border text-[14px] font-medium transition-colors',
            value === m ? 'border-volt-400 bg-volt-400/15 text-volt-400' : 'border-pitch-700 bg-pitch-800 text-chalk-muted hover:text-chalk',
          )}
        >
          {METHOD_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

export function MoneyInput({ value, onChange, currency, autoFocus, invalid, id }: {
  value: string
  onChange: (v: string) => void
  currency: string
  autoFocus?: boolean
  invalid?: boolean
  id?: string
}) {
  const symbol = formatMoney(0, currency).replace(/[\d.,\s]/g, '') || currency
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-chalk-muted">{symbol}</span>
      <Input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        className="numeric pl-9 text-lg"
        placeholder="0"
      />
    </div>
  )
}

function QuickAmounts({ amounts, currency, onPick }: { amounts: number[]; currency: string; onPick: (n: number) => void }) {
  const unique = [...new Set(amounts.filter((a) => a > 0))]
  if (unique.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {unique.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onPick(a)}
          className="numeric h-9 cursor-pointer rounded-full border border-pitch-700 bg-pitch-800 px-3.5 text-[13px] text-chalk-muted hover:text-chalk"
        >
          {formatMoney(a, currency)}
        </button>
      ))}
    </div>
  )
}

/**
 * A heading for a row of choice buttons. Not a <label>: a label wrapping
 * buttons forwards stray taps to the first one, which is exactly the
 * mis-tap we're avoiding.
 */
export function ChoiceGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-chalk-muted">{label}</span>
      {children}
    </div>
  )
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof ApiError ? error.message : 'That didn’t save. Check your connection and try again.'
  return <p role="alert" className="text-center text-[14px] text-card-red">{message}</p>
}

/* -------------------------------------------------------------------------- */

export interface SheetPlayer {
  id: string
  display_name: string
  balance: number
  game_fee: number
  monthly_fee: number
}

/** Record money received. Pre-fills what they owe. */
export function PaymentSheet({ open, onClose, player, currency, sessionId }: {
  open: boolean
  onClose: () => void
  player: SheetPlayer | null
  currency: string
  sessionId?: string
}) {
  const refresh = useFinanceRefresh()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    if (open && player) {
      setAmount(player.balance > 0 ? String(player.balance) : '')
      setNote('')
      setDate(format(new Date(), 'yyyy-MM-dd'))
    }
  }, [open, player])

  const save = useMutation({
    mutationFn: () =>
      api.post('finance/payments', {
        player_id: player!.id,
        amount: Number(amount),
        method,
        description: note.trim() || undefined,
        entry_date: date,
        session_id: sessionId,
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  const n = Number(amount)
  return (
    <Sheet open={open} onClose={onClose} title={player ? `Payment from ${player.display_name}` : 'Record payment'}>
      {player && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (n > 0) save.mutate()
          }}
        >
          <p className="text-[14px] text-chalk-muted">
            {player.balance > 0
              ? <>They owe <span className="numeric text-chalk">{formatMoney(player.balance, currency)}</span>.</>
              : player.balance < 0
                ? <>They are <span className="numeric text-chalk">{formatMoney(-player.balance, currency)}</span> in credit.</>
                : 'They are all paid up. Anything you record now sits as credit.'}
          </p>
          <Field label="Amount received">
            <MoneyInput value={amount} onChange={setAmount} currency={currency} autoFocus />
            <QuickAmounts amounts={[player.balance, player.game_fee, player.monthly_fee]} currency={currency} onPick={(a) => setAmount(String(a))} />
          </Field>
          <ChoiceGroup label="How did they pay?">
            <MethodPicker value={method} onChange={setMethod} />
          </ChoiceGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={date} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid Tunde" maxLength={200} />
            </Field>
          </div>
          <ErrorLine error={save.error} />
          <Button type="submit" size="lg" fullWidth disabled={!(n > 0)} loading={save.isPending}>
            {n > 0 ? `Record ${formatMoney(n, currency)}` : 'Enter an amount'}
          </Button>
        </form>
      )}
    </Sheet>
  )
}

/** Pay for a month (or several). The cycle keeps the day they started on. */
export function RenewSheet({ open, onClose, player, currency, lastEndsOn, today }: {
  open: boolean
  onClose: () => void
  player: SheetPlayer | null
  currency: string
  lastEndsOn: string | null
  today: string
}) {
  const refresh = useFinanceRefresh()
  const [start, setStart] = useState(today)
  const [months, setMonths] = useState(1)
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('transfer')

  const price = (player?.monthly_fee ?? 0) * months

  useEffect(() => {
    if (open && player) {
      setStart(suggestedStart(lastEndsOn, today))
      setMonths(1)
    }
  }, [open, player, lastEndsOn, today])

  useEffect(() => {
    if (open) setPaid(price ? String(price) : '')
  }, [months, price, open])

  const ends = start ? format(addMonths(parseISO(start), months), 'yyyy-MM-dd') : null

  const save = useMutation({
    mutationFn: () =>
      api.post('finance/subscriptions', {
        player_id: player!.id,
        starts_on: start,
        months,
        amount: price,
        paid_amount: Number(paid) || 0,
        method: Number(paid) > 0 ? method : undefined,
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  return (
    <Sheet open={open} onClose={onClose} title={player ? `Monthly for ${player.display_name}` : 'Monthly'}>
      {player && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <ChoiceGroup label="How many months?">
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 6].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  aria-pressed={months === m}
                  className={cn(
                    'h-12 cursor-pointer rounded-xl border text-[15px] font-medium',
                    months === m ? 'border-volt-400 bg-volt-400/15 text-volt-400' : 'border-pitch-700 bg-pitch-800 text-chalk-muted',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </ChoiceGroup>
          <Field
            label="Starts on"
            hint={lastEndsOn && start === lastEndsOn ? 'Carries straight on from their last month.' : undefined}
          >
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          {ends && (
            <div className="rounded-xl border border-pitch-700 bg-pitch-800 px-4 py-3 text-[14px]">
              Covers <span className="text-chalk">{niceDate(start)}</span> to <span className="text-chalk">{niceDate(ends)}</span>.
              <span className="mt-1 block text-chalk-muted">Next due on {niceDate(ends)}. Game fees in this period are cleared.</span>
            </div>
          )}
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="text-chalk-muted">Price</span>
            <span className="numeric text-lg text-chalk">{formatMoney(price, currency)}</span>
          </div>
          <Field label="Paid now" hint="Leave the full amount if they’ve paid. Lower it for a part payment, or 0 if they’ll pay later.">
            <MoneyInput value={paid} onChange={setPaid} currency={currency} />
          </Field>
          {Number(paid) > 0 && (
            <ChoiceGroup label="How did they pay?">
              <MethodPicker value={method} onChange={setMethod} />
            </ChoiceGroup>
          )}
          <ErrorLine error={save.error} />
          <Button type="submit" size="lg" fullWidth loading={save.isPending} disabled={!start}>
            Save month{months > 1 ? 's' : ''}
          </Button>
        </form>
      )}
    </Sheet>
  )
}

/** Add something owed, or forgive some of it. */
export function EntrySheet({ open, onClose, player, currency, kind }: {
  open: boolean
  onClose: () => void
  player: SheetPlayer | null
  currency: string
  kind: 'charge' | 'credit'
}) {
  const refresh = useFinanceRefresh()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (open) {
      setAmount('')
      setDescription('')
    }
  }, [open])

  const save = useMutation({
    mutationFn: () =>
      api.post(kind === 'charge' ? 'finance/charges' : 'finance/credits', {
        player_id: player!.id,
        amount: Number(amount),
        description: description.trim(),
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  const ok = Number(amount) > 0 && description.trim().length > 0
  return (
    <Sheet open={open} onClose={onClose} title={kind === 'charge' ? 'Add something they owe' : 'Take something off'}>
      {player && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate() }}>
          <p className="text-[14px] text-chalk-muted">
            {kind === 'charge'
              ? `For anything that isn’t a game fee or a month: a jersey, a fine, a tournament entry.`
              : `A discount or something you’re letting go. It lowers what ${player.display_name} owes.`}
          </p>
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} currency={currency} autoFocus />
          </Field>
          <Field label="What’s it for?">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={kind === 'charge' ? 'e.g. New jersey' : 'e.g. Birthday discount'}
              maxLength={200}
            />
          </Field>
          <ErrorLine error={save.error} />
          <Button type="submit" size="lg" fullWidth disabled={!ok} loading={save.isPending}>
            {kind === 'charge' ? 'Add charge' : 'Take it off'}
          </Button>
        </form>
      )}
    </Sheet>
  )
}

/** Cancel an entry. Kept on record with the reason. */
export function VoidSheet({ open, onClose, entryId, summary }: {
  open: boolean
  onClose: () => void
  entryId: string | null
  summary: string
}) {
  const refresh = useFinanceRefresh()
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])

  const save = useMutation({
    mutationFn: () => api.post(`finance/entries/${entryId}/void`, { reason: reason.trim() }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  return (
    <Sheet open={open} onClose={onClose} title="Cancel this entry?">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 2) save.mutate() }}>
        <p className="rounded-xl border border-pitch-700 bg-pitch-800 px-4 py-3 text-[14px] text-chalk">{summary}</p>
        <p className="text-[13.5px] text-chalk-muted">
          It stays in the history, crossed out, with your reason, so the numbers can always be checked.
        </p>
        <Field label="Why?">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded twice" autoFocus maxLength={200} />
        </Field>
        <ErrorLine error={save.error} />
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>Keep it</Button>
          <Button type="submit" variant="danger" size="lg" disabled={reason.trim().length < 2} loading={save.isPending}>Cancel entry</Button>
        </div>
      </form>
    </Sheet>
  )
}
