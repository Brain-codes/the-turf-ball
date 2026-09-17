/**
 * Platform feature switches (platform_features), flipped by the super admin.
 * A missing row counts as ON, so a new switch never breaks a live feature
 * before its migration has run.
 */

import type { SupabaseClient } from './db.ts'
import { AppError } from './errors.ts'

export type FeatureKey = 'new_groups' | 'public_tables' | 'head_to_head' | 'self_join_links' | 'contact_form'

export async function featureEnabled(db: SupabaseClient, key: FeatureKey): Promise<boolean> {
  const { data, error } = await db.from('platform_features').select('enabled').eq('key', key).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.enabled ?? true
}

/** Throw a clear 503 when a feature has been switched off. */
export async function requireFeature(db: SupabaseClient, key: FeatureKey, message: string): Promise<void> {
  if (!(await featureEnabled(db, key))) throw new AppError(message, 503)
}
