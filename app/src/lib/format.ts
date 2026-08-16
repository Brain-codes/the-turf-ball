import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, parseISO } from 'date-fns'

export function shortDate(value: string | Date): string {
  const d = typeof value === 'string' ? parseISO(value) : value
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  if (isTomorrow(d)) return 'Tomorrow'
  return format(d, 'd MMM')
}

export function fullDate(value: string | Date): string {
  const d = typeof value === 'string' ? parseISO(value) : value
  return format(d, 'EEEE d MMMM')
}

export function time(value: string | Date): string {
  const d = typeof value === 'string' ? parseISO(value) : value
  return format(d, 'h:mm a')
}

export function relative(value: string | Date): string {
  const d = typeof value === 'string' ? parseISO(value) : value
  return `${formatDistanceToNowStrict(d)} ago`
}

/** Points can be negative and fractional; never show "5.00" where "5" will do. */
export function points(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export const POSITION_LABEL: Record<string, string> = {
  GK: 'Goalkeeper',
  DEF: 'Defender',
  MID: 'Midfielder',
  FWD: 'Forward',
}

export const BAND_LABEL: Record<string, string> = {
  early: 'Early',
  on_time: 'On time',
  late: 'Late',
  very_late: 'Very late',
}
