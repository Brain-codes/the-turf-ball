/**
 * One player's money: their plan, balance, full history (including cancelled
 * entries, so nothing silently disappears) and their paid-for months.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { audit } from '../../_shared/helpers.ts'
import { num, oneOf, str, validate } from '../../_shared/validation.ts'
import { badRequest } from '../../_shared/errors.ts'
import { assertPlayer, financeAdmin, loadSettings, money, orgToday, subState } from './_access.ts'

const PLANS = ['monthly', 'per_game', 'exempt'] as const
const MAX = 100_000_000

/** GET players/:id */
export async function getPlayer(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const playerId = ctx.segments[1]
  const player = await assertPlayer(ctx, orgId, playerId)

  const [settings, today, rows, entries, subs, custom] = await Promise.all([
    loadSettings(ctx, orgId),
    orgToday(ctx, orgId),
    ctx.db.rpc('finance_player_rows', { p_org: orgId }),
    ctx.db
      .from('finance_entries')
      .select('id, kind, source, amount, description, method, entry_date, session_id, subscription_id, created_at, voided_at, void_reason, sessions(title, session_date), created_by_profile:profiles!finance_entries_created_by_fkey(full_name)')
      .eq('organization_id', orgId)
      .eq('player_id', playerId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false }),
    ctx.db
      .from('finance_subscriptions')
      .select('id, starts_on, ends_on, months, amount, created_at, voided_at')
      .eq('organization_id', orgId)
      .eq('player_id', playerId)
      .order('starts_on', { ascending: false }),
    ctx.db.from('player_finance').select('monthly_fee, game_fee').eq('player_id', playerId).maybeSingle(),
  ])
  if (rows.error) throw new Error(rows.error.message)
  if (entries.error) throw new Error(entries.error.message)
  if (subs.error) throw new Error(subs.error.message)

  // deno-lint-ignore no-explicit-any
  const row = (rows.data ?? []).find((r: any) => r.player_id === playerId) as Record<string, unknown> | undefined
  const plan = (row?.plan as string) ?? settings.default_plan
  const sub = subState((row?.sub_ends_on as string | null) ?? null, today, settings.remind_days_before)

  return successResponse({
    player,
    settings,
    today,
    plan,
    monthly_fee: money(row?.monthly_fee ?? settings.monthly_fee),
    game_fee: money(row?.game_fee ?? settings.game_fee),
    // The player's own fees, when they differ from the group's (null = group fee).
    custom_monthly_fee: custom.data?.monthly_fee == null ? null : money(custom.data.monthly_fee),
    custom_game_fee: custom.data?.game_fee == null ? null : money(custom.data.game_fee),
    balance: money(row?.balance ?? 0),
    charged: money(row?.charged ?? 0),
    paid: money(row?.paid ?? 0),
    credited: money(row?.credited ?? 0),
    sub_starts_on: row?.sub_starts_on ?? null,
    sub_ends_on: row?.sub_ends_on ?? null,
    sub_state: plan === 'monthly' ? sub.state : 'none',
    sub_days: plan === 'monthly' ? sub.days : null,
    games_this_month: row?.games_this_month ?? 0,
    entries: entries.data ?? [],
    subscriptions: subs.data ?? [],
  })
}

/**
 * PATCH players/:id — plan, personal fees (null = use the group's), phone.
 * Changing the plan only affects games from now on; past charges stay.
 */
export async function updatePlayer(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const playerId = ctx.segments[1]
  const player = await assertPlayer(ctx, orgId, playerId)

  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    plan: [oneOf(PLANS)],
    monthly_fee: [num(0, MAX)],
    game_fee: [num(0, MAX)],
    phone: [str(0, 24)],
  })

  if (body.phone !== undefined) {
    const phone = body.phone ? String(body.phone).replace(/[^\d+]/g, '') : null
    if (phone && phone.replace(/\D/g, '').length < 7) {
      throw badRequest('That phone number looks too short', { phone: ['That phone number looks too short'] })
    }
    const { error } = await ctx.db.from('players').update({ phone }).eq('id', playerId).eq('organization_id', orgId)
    if (error) throw new Error(error.message)
  }

  const touchesPlan = ['plan', 'monthly_fee', 'game_fee'].some((k) => body[k] !== undefined)
  if (touchesPlan) {
    const settings = await loadSettings(ctx, orgId)
    const { data: existing } = await ctx.db.from('player_finance').select('*').eq('player_id', playerId).maybeSingle()
    const plan = (body.plan as string | undefined) ?? existing?.plan ?? settings.default_plan
    const fee = (k: 'monthly_fee' | 'game_fee') =>
      body[k] === undefined ? existing?.[k] ?? null : body[k] === null || body[k] === '' ? null : money(body[k])

    const next = {
      player_id: playerId,
      organization_id: orgId,
      plan,
      monthly_fee: fee('monthly_fee'),
      game_fee: fee('game_fee'),
      plan_changed_at: existing && existing.plan === plan ? existing.plan_changed_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error } = await ctx.db.from('player_finance').upsert(next)
    if (error) throw new Error(error.message)
    await audit(ctx.db, orgId, member.user.id, 'finance.player_plan', 'player', playerId, existing, next)
  }

  return successResponse({ id: player.id }, 'Saved')
}
