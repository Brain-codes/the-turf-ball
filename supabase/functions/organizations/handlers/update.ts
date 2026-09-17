import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { conflict } from '../../_shared/errors.ts'
import { bool, int, oneOf, str, validate } from '../../_shared/validation.ts'
import { audit } from '../../_shared/helpers.ts'
import { uploadOrgLogo } from '../../_shared/storage.ts'

const FORMATS = ['5aside', '7aside', '11aside', 'custom'] as const
const FIELDS = [
  'name', 'short_name', 'description', 'location', 'venue',
  'format', 'players_per_side', 'playing_days', 'default_kickoff',
  'timezone', 'is_public',
] as const

export async function updateOrganization(ctx: Ctx): Promise<Response> {
  const orgId = ctx.segments[0]
  const member = await requireMember(ctx.req, ctx.db, 'admin', orgId)
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    name: [str(2, 80)],
    short_name: [str(1, 12)],
    description: [str(0, 500)],
    format: [oneOf(FORMATS)],
    players_per_side: [int(3, 11)],
    is_public: [bool],
  })

  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f]

  // Logos are uploaded here, never linked from elsewhere: send logo_base64 to
  // set one, or logo_url: null to remove it. Arbitrary URLs aren't accepted.
  if (typeof body.logo_base64 === 'string' && body.logo_base64) {
    patch.logo_url = await uploadOrgLogo(ctx.db, member.organizationId, body.logo_base64)
  } else if (body.logo_url === null) {
    patch.logo_url = null
  }

  if (Object.keys(patch).length === 0) {
    return successResponse({}, 'Nothing to update')
  }

  const { data, error } = await ctx.db
    .from('organizations')
    .update(patch)
    .eq('id', member.organizationId)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') throw conflict('That name is already taken')
    throw new Error(error.message)
  }

  const { logo_url: _logo, ...logged } = patch
  await audit(ctx.db, member.organizationId, member.user.id, 'organization.update', 'organization', member.organizationId, null, 'logo_url' in patch ? { ...logged, logo_changed: true } : patch)
  return successResponse(data, 'Group updated')
}
