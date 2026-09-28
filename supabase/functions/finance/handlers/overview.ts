/**
 * GET overview — the whole finance dashboard in one call: settings, the
 * headline numbers, a six-month trend, and one row per player.
 *
 * With finances switched off it still answers (enabled: false + settings),
 * so the screen can offer to switch them on.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { financeAdmin, loadSettings, money, orgToday, subState } from './_access.ts'

interface RawRow {
  player_id: string
  plan: 'monthly' | 'per_game' | 'exempt'
  monthly_fee: number
  game_fee: number
  charged: number
  paid: number
  credited: number
  balance: number
  sub_ends_on: string | null
  [key: string]: unknown
}

export async function overview(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx, { allowDisabled: true })
  const orgId = member.organizationId

  const [{ data: org }, settings, today] = await Promise.all([
    ctx.db.from('organizations').select('finance_enabled').eq('id', orgId).single(),
    loadSettings(ctx, orgId),
    orgToday(ctx, orgId),
  ])

  if (!org?.finance_enabled) {
    return successResponse({ enabled: false, settings, today })
  }

  const monthStart = `${today.slice(0, 7)}-01`
  const trendStart = new Date(`${monthStart}T00:00:00Z`)
  trendStart.setUTCMonth(trendStart.getUTCMonth() - 5)
  const trendFrom = trendStart.toISOString().slice(0, 10)

  const [rows, recent] = await Promise.all([
    ctx.db.rpc('finance_player_rows', { p_org: orgId }),
    ctx.db
      .from('finance_entries')
      .select('kind, amount, entry_date')
      .eq('organization_id', orgId)
      .is('voided_at', null)
      .in('kind', ['charge', 'payment'])
      .gte('entry_date', trendFrom),
  ])
  if (rows.error) throw new Error(rows.error.message)
  if (recent.error) throw new Error(recent.error.message)

  const players = ((rows.data ?? []) as RawRow[]).map((r) => {
    const monthly = r.plan === 'monthly'
    const sub = subState(r.sub_ends_on, today, settings.remind_days_before)
    return {
      ...r,
      monthly_fee: money(r.monthly_fee),
      game_fee: money(r.game_fee),
      charged: money(r.charged),
      paid: money(r.paid),
      credited: money(r.credited),
      balance: money(r.balance),
      sub_state: monthly ? sub.state : 'none',
      sub_days: monthly ? sub.days : null,
    }
  })

  // Six calendar months, oldest first, including empty ones.
  const trend: { month: string; charged: number; collected: number }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(trendStart)
    d.setUTCMonth(d.getUTCMonth() + i)
    trend.push({ month: d.toISOString().slice(0, 7), charged: 0, collected: 0 })
  }
  for (const e of recent.data ?? []) {
    const bucket = trend.find((t) => t.month === String(e.entry_date).slice(0, 7))
    if (!bucket) continue
    if (e.kind === 'payment') bucket.collected += Number(e.amount)
    else bucket.charged += Number(e.amount)
  }
  for (const t of trend) {
    t.charged = money(t.charged)
    t.collected = money(t.collected)
  }

  const owing = players.filter((p) => p.balance > 0)
  const summary = {
    outstanding: money(owing.reduce((s, p) => s + p.balance, 0)),
    owing_count: owing.length,
    credit_total: money(players.filter((p) => p.balance < 0).reduce((s, p) => s - p.balance, 0)),
    collected_this_month: trend[5].collected,
    charged_this_month: trend[5].charged,
    due_soon_count: players.filter((p) => p.sub_state === 'due_soon').length,
    expired_count: players.filter((p) => p.sub_state === 'expired').length,
    monthly_count: players.filter((p) => p.plan === 'monthly').length,
    per_game_count: players.filter((p) => p.plan === 'per_game').length,
    exempt_count: players.filter((p) => p.plan === 'exempt').length,
  }

  return successResponse({ enabled: true, settings, today, month_start: monthStart, summary, trend, players })
}

/** GET activity — the latest ledger entries across the group. */
export async function activity(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const limit = Math.min(Number(ctx.query.get('limit') ?? 30) || 30, 100)
  const { data, error } = await ctx.db
    .from('finance_entries')
    .select('id, player_id, kind, source, amount, description, method, entry_date, created_at, voided_at, void_reason, players(display_name, photo_url), created_by_profile:profiles!finance_entries_created_by_fkey(full_name)')
    .eq('organization_id', member.organizationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return successResponse(data ?? [])
}
