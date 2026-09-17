import type { SupabaseClient } from '../../_shared/db.ts'

/** Record a super admin change. Never blocks the change itself. */
export async function logAction(
  db: SupabaseClient,
  adminId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
) {
  const { error } = await db.from('admin_actions').insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  })
  if (error) console.error(JSON.stringify({ level: 'error', msg: 'admin log failed', error: error.message }))
}

/**
 * Escape % and _ so a search box can't turn into a wildcard pattern, and drop
 * the characters PostgREST's or() filter uses as syntax.
 */
export function likeTerm(raw: string | null): string | null {
  const t = raw?.replace(/[,()"'\\*]/g, ' ').trim().slice(0, 80)
  return t ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
}
