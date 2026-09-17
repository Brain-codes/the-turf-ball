/**
 * Admin head to head — same as the public one, plus the caller's own team
 * even if it isn't public. See _shared/headToHead.ts.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { loadHeadToHead, searchH2HPlayers, searchH2HTeams } from '../../_shared/headToHead.ts'

export async function memberH2H(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  return successResponse(await loadHeadToHead(ctx.db, ctx.query, member.organizationId), 'Head to head')
}

export async function memberH2HTeams(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const teams = await searchH2HTeams(ctx.db, ctx.query.get('search')?.trim() || null, member.organizationId)
  return successResponse(teams, 'Teams')
}

export async function memberH2HPlayers(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const rows = await searchH2HPlayers(ctx.db, {
    search: ctx.query.get('search')?.trim() || null,
    teamId: ctx.query.get('team_id'),
    ownOrgId: member.organizationId,
  })
  return successResponse(rows, 'Players')
}
