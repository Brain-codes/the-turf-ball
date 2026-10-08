/**
 * GET paid — who has paid last week, this week and this month, as plain lists.
 *
 * A payment belongs to the Sunday it was for: if it was recorded against a
 * session, that session's date decides; otherwise the day it was received.
 * So someone who paid on the Sunday evening for the next week's game shows up
 * under that next week.
 *
 * "This week" also lists anyone with money left over from earlier (credit),
 * because that money pays for this week's game when they're ticked in.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { financeAdmin, money, orgToday } from './_access.ts'

interface Row {
  amount: number
  entry_date: string
  player_id: string
  players: { display_name: string; photo_url: string | null } | null
  sessions: { session_date: string } | null
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week a date falls in. */
const weekStart = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(date, -((dow + 6) % 7))
}

export async function paid(ctx: Ctx): Promise<Response> {
  const member = await financeAdmin(ctx)
  const orgId = member.organizationId
  const today = await orgToday(ctx, orgId)

  const thisStart = weekStart(today)
  const lastStart = addDays(thisStart, -7)
  const monthStart = `${today.slice(0, 7)}-01`
  const earliest = lastStart < monthStart ? lastStart : monthStart

  // Pull a little wider than the windows, since the session date decides.
  const { data, error } = await ctx.db
    .from('finance_entries')
    .select('amount, entry_date, player_id, players(display_name, photo_url), sessions(session_date)')
    .eq('organization_id', orgId)
    .eq('kind', 'payment')
    .is('voided_at', null)
    .gte('entry_date', addDays(earliest, -14))
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, on: r.sessions?.session_date ?? r.entry_date }))

  const window = (from: string, to: string) => {
    const byPlayer = new Map<string, { player_id: string; display_name: string; photo_url: string | null; amount: number; payments: number }>()
    for (const r of rows) {
      if (r.on < from || r.on > to) continue
      const cur = byPlayer.get(r.player_id) ?? {
        player_id: r.player_id,
        display_name: r.players?.display_name ?? 'Player',
        photo_url: r.players?.photo_url ?? null,
        amount: 0,
        payments: 0,
      }
      cur.amount = money(cur.amount + Number(r.amount))
      cur.payments += 1
      byPlayer.set(r.player_id, cur)
    }
    const players = [...byPlayer.values()].sort((a, b) => b.amount - a.amount || a.display_name.localeCompare(b.display_name))
    return { from, to, total: money(players.reduce((s, p) => s + p.amount, 0)), players }
  }

  const last_week = window(lastStart, addDays(lastStart, 6))
  const this_week = window(thisStart, addDays(thisStart, 6))
  const month = window(monthStart, today > addDays(thisStart, 6) ? today : addDays(thisStart, 6))

  // Money still sitting in someone's account, for anyone not already listed for this week.
  const listed = new Set(this_week.players.map((p) => p.player_id))
  const credit = await ctx.db.rpc('finance_player_rows', { p_org: orgId })
  if (credit.error) throw new Error(credit.error.message)
  const carried = ((credit.data ?? []) as { player_id: string; display_name: string; photo_url: string | null; balance: number }[])
    .filter((p) => Number(p.balance) < 0 && !listed.has(p.player_id))
    .map((p) => ({ player_id: p.player_id, display_name: p.display_name, photo_url: p.photo_url, amount: money(-Number(p.balance)) }))
    .sort((a, b) => b.amount - a.amount || a.display_name.localeCompare(b.display_name))

  return successResponse({ today, last_week, this_week: { ...this_week, carried }, month })
}
