/**
 * Who may see the money: the group's owner and admins only. Recorders and
 * uploaders never reach any finance endpoint, and nothing here is public.
 *
 * A group switches finances on for itself (organizations.finance_enabled).
 * The super admin can also switch the whole feature off platform-wide.
 */

import type { Ctx } from '../../_shared/router.ts'
import { requireMember, type MemberContext } from '../../_shared/auth.ts'
import { requireFeature } from '../../_shared/features.ts'
import { AppError, notFound } from '../../_shared/errors.ts'

export async function financeAdmin(ctx: Ctx, { allowDisabled = false } = {}): Promise<MemberContext> {
  await requireFeature(ctx.db, 'finance', 'Finances are switched off right now.')
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  if (!allowDisabled) {
    const { data } = await ctx.db.from('organizations').select('finance_enabled').eq('id', member.organizationId).single()
    if (!data?.finance_enabled) throw new AppError('Finances aren’t switched on for this group. Turn them on in Settings → Money.', 403)
  }
  return member
}

export interface FinanceSettings {
  organization_id: string
  currency: string
  monthly_fee: number
  game_fee: number
  default_plan: 'monthly' | 'per_game' | 'exempt'
  remind_days_before: number
  charge_guests: boolean
}

/** The group's settings, or the defaults if they've never saved any. */
export async function loadSettings(ctx: Ctx, orgId: string): Promise<FinanceSettings> {
  const { data, error } = await ctx.db.from('finance_settings').select('*').eq('organization_id', orgId).maybeSingle()
  if (error) throw new Error(error.message)
  return {
    organization_id: orgId,
    currency: data?.currency ?? 'NGN',
    monthly_fee: Number(data?.monthly_fee ?? 0),
    game_fee: Number(data?.game_fee ?? 0),
    default_plan: data?.default_plan ?? 'per_game',
    remind_days_before: data?.remind_days_before ?? 3,
    charge_guests: data?.charge_guests ?? true,
  }
}

export async function orgToday(ctx: Ctx, orgId: string): Promise<string> {
  const { data, error } = await ctx.db.rpc('org_today', { p_org: orgId })
  if (error) throw new Error(error.message)
  return String(data)
}

/** A player in this group (any status except merged). */
export async function assertPlayer(ctx: Ctx, orgId: string, playerId: string) {
  const { data, error } = await ctx.db
    .from('players')
    .select('id, display_name, whatsapp_nickname, photo_url, phone, status')
    .eq('id', playerId)
    .eq('organization_id', orgId)
    .neq('status', 'merged')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Player not found')
  return data
}

/** Money in, rounded to kobo/cents. */
export const money = (v: unknown) => Math.round(Number(v) * 100) / 100

export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export type SubState = 'active' | 'due_soon' | 'expired' | 'none'

/** Where a monthly player's subscription stands today. */
export function subState(endsOn: string | null, today: string, remindDays: number): { state: SubState; days: number | null } {
  if (!endsOn) return { state: 'none', days: null }
  // ends_on is the renewal day itself: covered up to the day before it.
  const days = daysBetween(today, endsOn)
  if (days < 0) return { state: 'expired', days: -days }
  if (days <= remindDays) return { state: 'due_soon', days }
  return { state: 'active', days }
}
