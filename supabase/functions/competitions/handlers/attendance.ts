/** Attendance per fixture — deliberately mirrors sessions/handlers/attendance.ts in shape. */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { isArray, required, validate } from '../../_shared/validation.ts'

interface Entry {
  player_id: string
  status?: 'present' | 'absent' | 'excused'
}

export async function setFixtureAttendance(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  const fixtureId = ctx.segments[2] // ['id', 'fixtures', 'fixture_id', 'attendance']
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)
  await assertOwned(ctx.db, 'competition_fixtures', fixtureId, member.organizationId)

  const body = await ctx.body<{ entries: Entry[] }>()
  validate(body as unknown as Record<string, unknown>, { entries: [required, isArray(1, 200)] })

  const rows = body.entries.map((e) => ({
    organization_id: member.organizationId,
    competition_fixture_id: fixtureId,
    player_id: e.player_id,
    status: e.status ?? 'present',
  }))

  const { data, error } = await ctx.db
    .from('competition_fixture_attendance')
    .upsert(rows, { onConflict: 'competition_fixture_id,player_id' })
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, position)')

  if (error) throw new Error(error.message)

  const present = rows.filter((r) => r.status === 'present').length
  return successResponse(data ?? [], `${present} player(s) marked in`)
}
