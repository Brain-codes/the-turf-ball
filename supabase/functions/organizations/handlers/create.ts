/**
 * Create a football group. This is the single most compound write in the
 * product: an organization, its owner membership, its settings, its default
 * scoring rules, its first season and month, and its public page all have to
 * exist together or not at all.
 */

import type { Ctx } from '../../_shared/router.ts'
import { requireFeature } from '../../_shared/features.ts'
import { uploadOrgLogo } from '../../_shared/storage.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'
import { badRequest, conflict } from '../../_shared/errors.ts'
import { int, oneOf, required, slugify, str, validate } from '../../_shared/validation.ts'
import { audit, openPeriodId } from '../../_shared/helpers.ts'

const FORMATS = ['5aside', '7aside', '11aside', 'custom'] as const

interface Body {
  name: string
  short_name?: string
  slug?: string
  description?: string
  location?: string
  venue?: string
  format?: string
  players_per_side?: number
  playing_days?: string[]
  default_kickoff?: string
  timezone?: string
  logo_base64?: string
}

/** Find a free slug, appending -2, -3 … rather than rejecting the name. */
async function uniqueSlug(ctx: Ctx, desired: string): Promise<string> {
  const base = slugify(desired) || 'football-group'
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const { data } = await ctx.db
      .from('organizations')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`
}

export async function createOrganization(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)
  await requireFeature(ctx.db, 'new_groups', 'New groups are paused right now. Please try again later.')
  const body = await ctx.body<Body>()

  validate(body as unknown as Record<string, unknown>, {
    name: [required, str(2, 80)],
    short_name: [str(1, 12)],
    description: [str(0, 500)],
    location: [str(0, 120)],
    venue: [str(0, 120)],
    format: [oneOf(FORMATS)],
    players_per_side: [int(3, 11)],
  })

  if (body.logo_base64 && !/^data:image\/(jpeg|png|webp);base64,/.test(body.logo_base64)) {
    throw badRequest('Logo must be a JPEG, PNG or WebP image')
  }

  const slug = await uniqueSlug(ctx, body.slug || body.name)

  const { data: org, error } = await ctx.db
    .from('organizations')
    .insert({
      owner_id: user.id,
      name: body.name.trim(),
      short_name: body.short_name?.trim() || null,
      slug,
      description: body.description?.trim() || null,
      location: body.location?.trim() || null,
      venue: body.venue?.trim() || null,
      format: body.format ?? '5aside',
      players_per_side: body.players_per_side ?? 5,
      playing_days: body.playing_days ?? [],
      default_kickoff: body.default_kickoff ?? '17:00',
      timezone: body.timezone ?? 'Africa/Lagos',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') throw conflict('That group name is already taken')
    throw new Error(error.message)
  }

  // Everything below must exist for the group to function. If any of it fails,
  // remove the organization rather than leaving a half-built group that throws
  // confusing errors later — the cascade cleans up whatever did get created.
  try {
    const { error: memberErr } = await ctx.db.from('organization_members').insert({
      organization_id: org.id,
      user_id: user.id,
      role: 'owner',
      status: 'active',
    })
    if (memberErr) throw new Error(memberErr.message)

    const { error: settingsErr } = await ctx.db
      .from('org_settings')
      .insert({ organization_id: org.id })
    if (settingsErr) throw new Error(settingsErr.message)

    const { error: rulesErr } = await ctx.db.rpc('seed_default_scoring_rules', { p_org: org.id })
    if (rulesErr) throw new Error(rulesErr.message)

    const { error: pageErr } = await ctx.db
      .from('public_pages')
      .insert({ organization_id: org.id, slug })
    if (pageErr) throw new Error(pageErr.message)

    const periodId = await openPeriodId(ctx.db, org.id)

    // The logo is optional: if it fails, the group still gets created and the
    // logo can be added later in Settings.
    if (body.logo_base64) {
      try {
        org.logo_url = await uploadOrgLogo(ctx.db, org.id, body.logo_base64)
        await ctx.db.from('organizations').update({ logo_url: org.logo_url }).eq('id', org.id)
      } catch (logoErr) {
        ctx.log.warn('logo upload failed', { error: String(logoErr) })
      }
    }

    await ctx.db.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', user.id)
    await audit(ctx.db, org.id, user.id, 'organization.create', 'organization', org.id)

    return successResponse(
      { ...org, role: 'owner', period_id: periodId, public_url: `/t/${slug}` },
      `${org.name} is ready`,
      {},
      201,
    )
  } catch (err) {
    await ctx.db.from('organizations').delete().eq('id', org.id)
    ctx.log.error('org setup failed, rolled back', { error: String(err) })
    throw new Error('Could not finish setting up the group. Please try again.')
  }
}
