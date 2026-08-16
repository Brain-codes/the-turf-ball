/**
 * Validation. Deliberately hand-rolled rather than pulling Zod into every
 * function bundle — the rules here are simple and cold-start time matters on
 * a phone at a pitch with one bar of signal.
 *
 * Error messages are written for the organizer, not the developer.
 */

import { badRequest } from './errors.ts'

type Rule = (value: unknown, field: string) => string | null

/**
 * Field names are database columns; the messages built from them are read by
 * an organizer standing at a pitch. "Your name must be at least 2 characters"
 * beats "full_name must be at least 2 characters".
 */
const FIELD_LABELS: Record<string, string> = {
  full_name: 'Your name',
  display_name: 'Name',
  first_name: 'First name',
  last_name: 'Last name',
  jersey_number: 'Shirt number',
  short_name: 'Short name',
  players_per_side: 'Players per side',
  kickoff_at: 'Kick-off time',
  session_id: 'Session',
  match_id: 'Match',
  player_id: 'Player',
  related_player_id: 'The other player',
  event_type: 'Event type',
  side_a: 'Blue team',
  side_b: 'Red team',
  duration_minutes: 'Match length',
  invited_email: 'Email',
  client_key: 'Reference',
  preferred_foot: 'Preferred foot',
  entries: 'Attendance',
  names: 'Names',
  rules: 'Scoring rules',
  events: 'Events',
  email: 'Email',
  password: 'Password',
  token: 'Invitation code',
  name: 'Name',
  slug: 'Link',
  position: 'Position',
  status: 'Status',
  role: 'Role',
  venue: 'Venue',
  location: 'Location',
  description: 'Description',
  title: 'Title',
  minute: 'Minute',
  notes: 'Notes',
  format: 'Format',
  avatar_url: 'Photo',
  photo_url: 'Photo',
}

function label(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ')
}

export const required: Rule = (v, f) =>
  v === undefined || v === null || v === '' ? `${label(f)} is required` : null

export const str = (min = 0, max = 500): Rule => (v, f) => {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return `${label(f)} must be text`
  if (v.trim().length < min) return `${label(f)} must be at least ${min} characters`
  if (v.length > max) return `${label(f)} must be under ${max} characters`
  return null
}

export const email: Rule = (v, f) => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    return `${label(f)} must be a valid email address`
  }
  return null
}

export const int = (min?: number, max?: number): Rule => (v, f) => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n)) return `${label(f)} must be a whole number`
  if (min !== undefined && n < min) return `${label(f)} must be at least ${min}`
  if (max !== undefined && n > max) return `${label(f)} must be no more than ${max}`
  return null
}

export const num = (min?: number, max?: number): Rule => (v, f) => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return `${label(f)} must be a number`
  if (min !== undefined && n < min) return `${label(f)} must be at least ${min}`
  if (max !== undefined && n > max) return `${label(f)} must be no more than ${max}`
  return null
}

export const oneOf = (values: readonly string[]): Rule => (v, f) => {
  if (v === undefined || v === null || v === '') return null
  return values.includes(v as string) ? null : `${label(f)} must be one of: ${values.join(', ')}`
}

export const uuid: Rule = (v, f) => {
  if (v === undefined || v === null || v === '') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v))
    ? null
    : `${label(f)} is not a valid id`
}

export const bool: Rule = (v, f) =>
  v === undefined || v === null || typeof v === 'boolean' ? null : `${label(f)} must be true or false`

export const isArray = (min = 0, max = 500): Rule => (v, f) => {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) return `${label(f)} must be a list`
  if (v.length < min) return `${label(f)} must have at least ${min} item(s)`
  if (v.length > max) return `${label(f)} cannot have more than ${max} items`
  return null
}

export type Schema = Record<string, Rule[]>

/** Runs every rule and reports ALL failures at once, so a form fixes in one pass. */
export function validate(payload: Record<string, unknown>, schema: Schema): void {
  const errors: Record<string, string[]> = {}

  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules) {
      const message = rule(payload[field], field)
      if (message) {
        ;(errors[field] ??= []).push(message)
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest('Please check the highlighted fields', errors)
  }
}

/** Turn a name into a URL-safe slug: "Abuja Sunday Ballers" -> "abuja-sunday-ballers" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
