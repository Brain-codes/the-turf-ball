import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { orgSettings, resolvePeriod } from '../../_shared/helpers.ts'

export async function leaderboard(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const period = await resolvePeriod(ctx.db, member.organizationId, ctx.query.get('period_id'))
  const settings = await orgSettings(ctx.db, member.organizationId)

  const { data, error } = await ctx.db
    .from('player_period_stats')
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, jersey_number, position, status)')
    .eq('period_id', period.id)
    .order('rank', { ascending: true })

  if (error) throw new Error(error.message)

  let rows = data ?? []

  // Players who have not turned up yet sit at zero and would pad the table
  // with noise, so they are held back until they have played.
  rows = rows.filter((r: Record<string, unknown>) => (r.appearances as number) > 0)

  if (!settings.guests_on_leaderboard) {
    rows = rows.filter((r: Record<string, unknown>) => {
      const p = r.players as { status?: string } | null
      return p?.status !== 'guest'
    })
  }

  return successResponse(rows, 'Leaderboard', { period, total: rows.length })
}
