/**
 * Writing to the ledger. Every write is by an owner/admin and is permanent:
 * mistakes are voided with a reason, never deleted.
 *
 *   POST payments       money received (cash / transfer / card / other)
 *   POST charges        something owed that isn't a game fee or a month
 *   POST credits        money forgiven (discount, waiver)
 *   POST subscriptions  a paid-for month (or months), optionally paid now
 *   POST entries/:id/void
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { audit } from '../../_shared/helpers.ts'
import { int, num, oneOf, required, str, uuid, validate } from '../../_shared/validation.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { assertPlayer, financeAdmin, isDate, loadSettings, money, orgToday } from './_access.ts'

const METHODS = ['cash', 'transfer', 'card', 'other'] as const
const MAX = 100_000_000

async function insertEntry(ctx: Ctx, kind: 'payment' | 'charge' | 'credit'): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    player_id: [required, uuid],
    amount: [required, num(0.01, MAX)],
    method: kind === 'payment' ? [required, oneOf(METHODS)] : [oneOf(METHODS)],
    description: kind === 'payment' ? [str(0, 200)] : [required, str(1, 200)],
    session_id: [uuid],
  })
  await assertPlayer(ctx, orgId, String(body.player_id))

  if (body.session_id) {
    const { data } = await ctx.db.from('sessions').select('id').eq('id', body.session_id).eq('organization_id', orgId).maybeSingle()
    if (!data) throw notFound('Session not found')
  }

  const today = await orgToday(ctx, orgId)
  const entryDate = isDate(body.entry_date) ? body.entry_date : today
  if (entryDate > today) throw badRequest('That date is in the future', { entry_date: ['That date is in the future'] })

  const { data, error } = await ctx.db.from('finance_entries').insert({
    organization_id: orgId,
    player_id: body.player_id,
    kind,
    source: 'manual',
    amount: money(body.amount),
    description: body.description ? String(body.description).trim() : null,
    method: kind === 'payment' ? body.method : null,
    entry_date: entryDate,
    session_id: body.session_id ?? null,
    created_by: member.user.id,
  }).select('*').single()
  if (error) throw new Error(error.message)

  await audit(ctx.db, orgId, member.user.id, `finance.${kind}`, 'finance_entry', data.id, null, data)
  const label = kind === 'payment' ? 'Payment recorded' : kind === 'charge' ? 'Charge added' : 'Credit added'
  return successResponse(data, label, {}, 201)
}

export const recordPayment = (ctx: Ctx) => insertEntry(ctx, 'payment')
export const addCharge = (ctx: Ctx) => insertEntry(ctx, 'charge')
export const addCredit = (ctx: Ctx) => insertEntry(ctx, 'credit')

/** POST subscriptions { player_id, starts_on, months, amount?, paid_amount?, method?, note? } */
export async function recordSubscription(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    player_id: [required, uuid],
    starts_on: [required],
    months: [int(1, 12)],
    amount: [num(0, MAX)],
    paid_amount: [num(0, MAX)],
    method: [oneOf(METHODS)],
    note: [str(0, 200)],
  })
  if (!isDate(body.starts_on)) throw badRequest('Pick a start date', { starts_on: ['Pick a start date'] })
  const player = await assertPlayer(ctx, orgId, String(body.player_id))

  const months = Number(body.months ?? 1)
  let amount = body.amount
  if (amount === undefined || amount === null || amount === '') {
    const [{ data: pf }, settings] = await Promise.all([
      ctx.db.from('player_finance').select('monthly_fee').eq('player_id', player.id).maybeSingle(),
      loadSettings(ctx, orgId),
    ])
    amount = Number(pf?.monthly_fee ?? settings.monthly_fee) * months
  }
  const paid = money(body.paid_amount ?? 0)
  if (paid > 0 && !body.method) throw badRequest('How did they pay?', { method: ['How did they pay?'] })

  const { data, error } = await ctx.db.rpc('finance_record_subscription', {
    p_org: orgId,
    p_player: player.id,
    p_actor: member.user.id,
    p_starts_on: body.starts_on,
    p_months: months,
    p_amount: money(amount),
    p_paid: paid,
    p_method: body.method ?? null,
    p_note: body.note ?? null,
  })
  if (error) {
    if (/overlaps/i.test(error.message)) {
      throw badRequest('Those dates overlap a month already recorded for this player. Start after it ends, or cancel that one first.')
    }
    throw new Error(error.message)
  }

  await audit(ctx.db, orgId, member.user.id, 'finance.subscription', 'player', player.id, null, { ...body, result: data })
  return successResponse(data, `${player.display_name} is covered until ${data.ends_on}`, {}, 201)
}

/** POST entries/:id/void { reason } */
export async function voidEntry(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const entryId = ctx.segments[1]
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, { reason: [required, str(2, 200)] })

  const { data: before } = await ctx.db.from('finance_entries').select('*').eq('id', entryId).eq('organization_id', orgId).maybeSingle()
  if (!before) throw notFound('Entry not found')
  if (before.voided_at) throw badRequest('That entry is already cancelled')

  const { data, error } = await ctx.db.rpc('finance_void_entry', {
    p_org: orgId,
    p_entry: entryId,
    p_actor: member.user.id,
    p_reason: String(body.reason).trim(),
  })
  if (error) throw new Error(error.message)

  await audit(ctx.db, orgId, member.user.id, 'finance.void', 'finance_entry', entryId, before, { reason: body.reason })
  return successResponse(data, data?.subscription_voided ? 'Month cancelled. Any game fees it covered are back on.' : 'Entry cancelled')
}

/**
 * GET sessions/:id — the "collect today's fees" list: everyone marked present,
 * what they were charged for this game, and whether they've paid for it.
 */
export async function sessionFees(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const sessionId = ctx.segments[1]

  const { data: session } = await ctx.db.from('sessions').select('id, session_date, status').eq('id', sessionId).eq('organization_id', orgId).maybeSingle()
  if (!session) throw notFound('Session not found')

  const [attendance, entries, rows] = await Promise.all([
    ctx.db
      .from('session_attendance')
      .select('player_id, players(id, display_name, whatsapp_nickname, photo_url)')
      .eq('session_id', sessionId)
      .eq('status', 'present'),
    ctx.db
      .from('finance_entries')
      .select('id, player_id, kind, source, amount, method')
      .eq('session_id', sessionId)
      .is('voided_at', null),
    ctx.db.rpc('finance_player_rows', { p_org: orgId }),
  ])
  if (attendance.error) throw new Error(attendance.error.message)
  if (entries.error) throw new Error(entries.error.message)
  if (rows.error) throw new Error(rows.error.message)

  // deno-lint-ignore no-explicit-any
  const byPlayer = new Map((rows.data ?? []).map((r: any) => [r.player_id, r]))

  const list = (attendance.data ?? []).map((a) => {
    const mine = (entries.data ?? []).filter((e) => e.player_id === a.player_id)
    const charge = mine.find((e) => e.kind === 'charge' && e.source === 'game')
    const payments = mine.filter((e) => e.kind === 'payment')
    const paid = payments.reduce((s, e) => s + Number(e.amount), 0)
    // deno-lint-ignore no-explicit-any
    const row = byPlayer.get(a.player_id) as any
    const covered = row?.plan === 'monthly' && row?.sub_starts_on && row.sub_starts_on <= session.session_date && session.session_date < row.sub_ends_on
    let status: 'paid' | 'unpaid' | 'part_paid' | 'covered' | 'free' | 'no_fee'
    if (charge) status = paid >= Number(charge.amount) ? 'paid' : paid > 0 ? 'part_paid' : 'unpaid'
    else if (row?.plan === 'exempt') status = 'free'
    else if (covered) status = 'covered'
    else status = 'no_fee'
    return {
      player: a.players,
      plan: row?.plan ?? 'per_game',
      fee: charge ? money(charge.amount) : 0,
      paid: money(paid),
      payment_ids: payments.map((e) => e.id),
      balance: money(row?.balance ?? 0),
      status,
    }
  })
  // deno-lint-ignore no-explicit-any
  list.sort((x: any, y: any) => String(x.player?.display_name).localeCompare(String(y.player?.display_name)))

  return successResponse({
    session_id: sessionId,
    players: list,
    total_due: money(list.reduce((s, p) => s + p.fee, 0)),
    total_paid: money(list.reduce((s, p) => s + Math.min(p.paid, p.fee || p.paid), 0)),
  })
}
