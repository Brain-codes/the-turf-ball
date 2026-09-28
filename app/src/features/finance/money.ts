import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { FinancePlan, FinancePlayerRow, PaymentMethod, SubState } from '@/types'

/** "₦15,000" — whole amounts without decimals, kobo only when there are some. */
export function formatMoney(amount: number, currency = 'NGN'): string {
  const whole = Number.isInteger(Math.round(amount * 100) / 100)
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString()}`
  }
}

export const CURRENCIES = [
  { code: 'NGN', label: 'Naira (₦)' },
  { code: 'GHS', label: 'Cedi (GH₵)' },
  { code: 'KES', label: 'Kenyan shilling (KSh)' },
  { code: 'ZAR', label: 'Rand (R)' },
  { code: 'GBP', label: 'Pound (£)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'USD', label: 'Dollar ($)' },
]

export const PLAN_LABEL: Record<FinancePlan, string> = {
  monthly: 'Monthly',
  per_game: 'Pay as you play',
  exempt: 'Free',
}

export const PLAN_HINT: Record<FinancePlan, string> = {
  monthly: 'Pays once a month, from the day they started. Plays as often as they like.',
  per_game: 'Charged the game fee each time they are ticked in at a session.',
  exempt: 'Never charged. For organisers, keepers you bring in, and so on.',
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  card: 'Card',
  other: 'Other',
}

export function niceDate(value: string): string {
  return format(parseISO(value), 'd MMM yyyy')
}

export function shortNiceDate(value: string): string {
  return format(parseISO(value), 'd MMM')
}

/** The plain-English line under a monthly player's name. */
export function subLine(state: SubState, days: number | null, endsOn: string | null): string {
  if (state === 'none') return 'No month paid yet'
  if (!endsOn) return ''
  if (state === 'expired') return days === 1 ? 'Ran out yesterday' : `Ran out ${days} days ago`
  if (state === 'due_soon') {
    if (days === 0) return 'Due today'
    if (days === 1) return 'Due tomorrow'
    return `Due in ${days} days · ${shortNiceDate(endsOn)}`
  }
  return `Paid until ${shortNiceDate(endsOn)}`
}

/**
 * Where a renewal should start. Carries on from the last month if it ran out
 * recently or hasn't yet (joined on the 16th stays on the 16th); a player who
 * has been away a while restarts from today.
 */
export function suggestedStart(endsOn: string | null, today: string): string {
  if (!endsOn) return today
  const gap = differenceInCalendarDays(parseISO(today), parseISO(endsOn))
  return gap <= 7 ? endsOn : today
}

/** WhatsApp wants digits only, with the country code. 0803… becomes 234803… */
export function whatsappNumber(phone: string | null | undefined, defaultCountry = '234'): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (phone.trim().startsWith('+')) return digits
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('0')) digits = defaultCountry + digits.slice(1)
  return digits
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const number = whatsappNumber(phone)
  const q = `text=${encodeURIComponent(text)}`
  return number ? `https://wa.me/${number}?${q}` : `https://wa.me/?${q}`
}

/** The reminder message, written the way an organiser would say it. */
export function reminderText(row: Pick<FinancePlayerRow, 'display_name' | 'plan' | 'balance' | 'sub_state' | 'sub_days' | 'sub_ends_on' | 'monthly_fee'>, groupName: string, currency: string): string {
  const name = row.display_name.split(' ')[0]
  const lines: string[] = [`Hi ${name} 👋`]

  if (row.plan === 'monthly' && row.sub_ends_on && (row.sub_state === 'due_soon' || row.sub_state === 'expired')) {
    const when = niceDate(row.sub_ends_on)
    if (row.sub_state === 'expired') {
      lines.push(`Your ${groupName} monthly subscription ran out on ${when}.`)
    } else if (row.sub_days === 0) {
      lines.push(`Your ${groupName} monthly subscription is due today (${when}).`)
    } else {
      lines.push(`Your ${groupName} monthly subscription runs out on ${when}.`)
    }
    if (row.monthly_fee > 0) lines.push(`Please don't forget to renew (${formatMoney(row.monthly_fee, currency)}).`)
    else lines.push(`Please don't forget to renew.`)
  }

  if (row.balance > 0) {
    lines.push(`${lines.length > 1 ? 'You also owe' : `Quick one from ${groupName}: you owe`} ${formatMoney(row.balance, currency)}.`)
  }

  if (lines.length === 1) lines.push(`Quick reminder from ${groupName} about your subscription.`)
  lines.push('Thanks! ⚽')
  return lines.join('\n')
}

/** Does this player need chasing? */
export function needsAttention(row: FinancePlayerRow): boolean {
  return row.balance > 0 || row.sub_state === 'due_soon' || row.sub_state === 'expired'
}
