/** Public head to head — public teams only, no login. See _shared/headToHead.ts. */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { loadHeadToHead, searchH2HPlayers, searchH2HTeams } from '../../_shared/headToHead.ts'

export async function publicH2H(ctx: Ctx): Promise<Response> {
  return successResponse(await loadHeadToHead(ctx.db, ctx.query), 'Head to head')
}

export async function publicH2HTeams(ctx: Ctx): Promise<Response> {
  return successResponse(await searchH2HTeams(ctx.db, ctx.query.get('search')?.trim() || null), 'Teams')
}

export async function publicH2HPlayers(ctx: Ctx): Promise<Response> {
  const rows = await searchH2HPlayers(ctx.db, {
    search: ctx.query.get('search')?.trim() || null,
    teamId: ctx.query.get('team_id'),
  })
  return successResponse(rows, 'Players')
}
