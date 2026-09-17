/**
 * GET /public/features — which platform features are switched on, so the app
 * can hide what the super admin has turned off. Keys and on/off only.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'

export async function listFeatures(ctx: Ctx): Promise<Response> {
  const { data, error } = await ctx.db.from('platform_features').select('key, enabled')
  if (error) throw new Error(error.message)
  const flags = Object.fromEntries((data ?? []).map((f) => [f.key, f.enabled]))
  return successResponse(flags)
}
