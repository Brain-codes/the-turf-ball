/**
 * PATCH settings — switch finances on/off for the group and set the fees.
 * Owner/admin only. Every change lands in the audit log.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { audit } from '../../_shared/helpers.ts'
import { bool, int, num, oneOf, validate } from '../../_shared/validation.ts'
import { badRequest } from '../../_shared/errors.ts'
import { financeAdmin, loadSettings, money } from './_access.ts'

const PLANS = ['monthly', 'per_game', 'exempt'] as const
const MAX = 100_000_000

export async function updateSettings(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx, { allowDisabled: true })
  const orgId = member.organizationId
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    finance_enabled: [bool],
    monthly_fee: [num(0, MAX)],
    game_fee: [num(0, MAX)],
    default_plan: [oneOf(PLANS)],
    remind_days_before: [int(0, 14)],
    charge_guests: [bool],
  })
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(String(body.currency))) {
    throw badRequest('Pick a currency', { currency: ['Pick a currency'] })
  }

  const before = await loadSettings(ctx, orgId)
  const patch: Record<string, unknown> = {}
  if (body.currency !== undefined) patch.currency = body.currency
  if (body.monthly_fee !== undefined) patch.monthly_fee = money(body.monthly_fee)
  if (body.game_fee !== undefined) patch.game_fee = money(body.game_fee)
  if (body.default_plan !== undefined) patch.default_plan = body.default_plan
  if (body.remind_days_before !== undefined) patch.remind_days_before = Number(body.remind_days_before)
  if (body.charge_guests !== undefined) patch.charge_guests = body.charge_guests

  if (Object.keys(patch).length > 0) {
    const { error } = await ctx.db.from('finance_settings').upsert({
      ...before,
      ...patch,
      organization_id: orgId,
      updated_at: new Date().toISOString(),
      updated_by: member.user.id,
    })
    if (error) throw new Error(error.message)
    await audit(ctx.db, orgId, member.user.id, 'finance.settings', 'finance_settings', orgId, before, patch)
  }

  if (typeof body.finance_enabled === 'boolean') {
    const { error } = await ctx.db.from('organizations').update({ finance_enabled: body.finance_enabled }).eq('id', orgId)
    if (error) throw new Error(error.message)
    await audit(ctx.db, orgId, member.user.id, body.finance_enabled ? 'finance.enable' : 'finance.disable', 'organization', orgId)
  }

  const settings = await loadSettings(ctx, orgId)
  const message = body.finance_enabled === true
    ? 'Finances switched on'
    : body.finance_enabled === false
      ? 'Finances switched off. Nothing was deleted.'
      : 'Money settings saved'
  return successResponse(settings, message)
}
