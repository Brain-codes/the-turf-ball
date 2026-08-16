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

/** "2 hours remaining" for anything under 24 hours away, else a plain date. */
export function countdown(value: string | Date): string {
  const d = typeof value === 'string' ? parseISO(value) : value
  const ms = d.getTime() - Date.now()
  if (ms <= 0) return 'Starting now'
  if (ms > 24 * 60 * 60 * 1000) return `${shortDate(d)} · ${time(d)}`
  return `${formatDistanceToNowStrict(d)} remaining`
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
  RB: 'Right Back',
  CB: 'Centre Back',
  LB: 'Left Back',
  CDM: 'Defensive Mid',
  CM: 'Centre Mid',
  CAM: 'Attacking Mid',
  LM: 'Left Mid',
  RM: 'Right Mid',
  LW: 'Left Wing',
  RW: 'Right Wing',
  ST: 'Striker',
  CF: 'Centre Forward',
}

/** Grouped for position <select> menus, roughly back to front. */
export const POSITION_GROUPS: { label: string; options: (keyof typeof POSITION_LABEL)[] }[] = [
  { label: 'Goalkeeper', options: ['GK'] },
  { label: 'Defence', options: ['RB', 'CB', 'LB'] },
  { label: 'Midfield', options: ['CDM', 'CM', 'CAM', 'LM', 'RM'] },
  { label: 'Attack', options: ['LW', 'RW', 'ST', 'CF'] },
]

export const BAND_LABEL: Record<string, string> = {
  early: 'Early',
  on_time: 'On time',
  late: 'Late',
  very_late: 'Very late',
}
