/**
 * Self-serve player invite. The one deliberate write path in the `public`
 * function (see the note in publicPage.ts's header, updated by this
 * feature). A prospective player visits `/join/<org-slug>` — unauthenticated
 * — and submits their own name, kit/nickname, preferred foot and optional
 * photo. This creates a `players` row with status = 'pending'; an admin then
 * approves or rejects it (players/handlers/approve.ts).
 *
 * Deliberately resolved by the organization's own slug, not the public
 * leaderboard page's slug/is_published flag — the invite link works even if
 * the organizer hasn't published a public leaderboard, because inviting your
 * squad and sharing your stats page are two different decisions.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { notFound } from '../../_shared/errors.ts'
import { oneOf, required, str, validate } from '../../_shared/validation.ts'
import { uploadPlayerPhoto } from '../../_shared/storage.ts'

const FEET = ['left', 'right', 'both'] as const
const POSITIONS = [
  'GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF',
] as const

export async function joinTeam(ctx: Ctx): Promise<Response> {
  const slug = ctx.segments[0]
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    first_name: [required, str(1, 40)],
    last_name: [str(0, 40)],
    display_name: [str(1, 40)],
    whatsapp_nickname: [str(0, 40)],
    preferred_foot: [oneOf(FEET)],
    position: [oneOf(POSITIONS)],
  })

  const { data: org, error: orgErr } = await ctx.db
    .from('organizations')
    .select('id, name, deleted_at')
    .eq('slug', slug)
    .maybeSingle()

  if (orgErr) throw new Error(orgErr.message)
  if (!org || org.deleted_at) throw notFound('That invite link is not available')

  const firstName = String(body.first_name).trim()

  let photoUrl: string | null = null
  if (body.photo_base64) {
    photoUrl = await uploadPlayerPhoto(ctx.db, org.id, String(body.photo_base64))
  }

  const { data, error } = await ctx.db
    .from('players')
    .insert({
      organization_id: org.id,
      first_name: firstName,
      last_name: body.last_name ? String(body.last_name).trim() : null,
      display_name: body.display_name ? String(body.display_name).trim() : firstName,
      whatsapp_nickname: body.whatsapp_nickname ? String(body.whatsapp_nickname).trim() : null,
      preferred_foot: body.preferred_foot ?? null,
      position: body.position ?? null,
      photo_url: photoUrl,
      status: 'pending',
      created_by: null,
    })
    .select('id, display_name')
    .single()

  if (error) throw new Error(error.message)

  return successResponse(
    data,
    `Thanks, ${data.display_name}! Your request to join ${org.name} is waiting on an admin to approve it.`,
    {},
    201,
  )
}
