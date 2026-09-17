/**
 * Platform feature switches.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireSuperAdmin } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { bool, required, validate } from '../../_shared/validation.ts'
import { logAction } from './_log.ts'

export async function listFeatures(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const { data, error } = await ctx.db
    .from('platform_features')
    .select('key, label, description, enabled, updated_at, updated_by:profiles(email)')
    .order('label')
  if (error) throw new Error(error.message)
  return successResponse(data ?? [])
}

export async function updateFeature(ctx: Ctx): Promise<Response> {
  const admin = await requireSuperAdmin(ctx.req, ctx.db)
  const key = ctx.segments[1]
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, { enabled: [required, bool] })

  const { data, error } = await ctx.db
    .from('platform_features')
    .update({ enabled: body.enabled, updated_at: new Date().toISOString(), updated_by: admin.id })
    .eq('key', key)
    .select('key, label, enabled')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Feature not found')

  await logAction(ctx.db, admin.id, body.enabled ? 'feature.on' : 'feature.off', 'feature', key, { label: data.label })
  return successResponse(data, `${data.label} ${data.enabled ? 'switched on' : 'switched off'}`)
}
