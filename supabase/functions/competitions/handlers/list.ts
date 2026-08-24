import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'

const SELECT = `
  *,
  competition_teams(id, name, short_name, color, captain_player_id, sort_order)
`

export async function listCompetitions(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)

  let query = ctx.db
    .from('competitions')
    .select(SELECT)
    .eq('organization_id', member.organizationId)
    .is('voided_at', null)
    .order('starts_on', { ascending: false })

  // Timeline lookup: does a competition cover this specific date? Used by
  // the sessions screen to render a competition card instead of a session
  // row on any date a tournament has claimed.
  const overlapsDate = ctx.query.get('overlaps_date')
  if (overlapsDate) {
    query = query.lte('starts_on', overlapsDate).gte('ends_on', overlapsDate)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return successResponse(data ?? [])
}

export async function getCompetition(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const id = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', id, member.organizationId)

  const { data, error } = await ctx.db
    .from('competitions')
    .select(`
      *,
      competition_teams(id, name, short_name, color, captain_player_id, sort_order,
        competition_team_players(id, player_id, joined_at, removed_at,
          players(id, display_name, whatsapp_nickname, photo_url, position, jersey_number))
      ),
      competition_players(id, player_id, joined_at, removed_at,
        players(id, display_name, whatsapp_nickname, photo_url, position, jersey_number))
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound('Competition not found')
  return successResponse(data)
}
