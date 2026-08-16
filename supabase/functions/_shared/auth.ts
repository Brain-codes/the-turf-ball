/**
 * Authentication and tenant authorization. SPEC.md §10.6.
 *
 * Every mutating request resolves, in this order:
 *   1. JWT -> user id
 *   2. organization_members row for (user, target org) with status 'active'
 *   3. role against the endpoint's requirement
 *   4. all subsequent queries scoped by organization_id
 *
 * No handler is permitted to skip step 2. The React app hiding a button is a
 * convenience, never a control.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { forbidden, notFound, unauthorized } from './errors.ts'
import type { SupabaseClient } from './db.ts'

export interface AuthUser {
  id: string
  email: string
}

export interface MemberContext {
  user: AuthUser
  organizationId: string
  role: 'owner' | 'admin' | 'recorder'
}

const ROLE_RANK: Record<string, number> = { recorder: 1, admin: 2, owner: 3 }

/** Verify the bearer token. Throws 401 if absent or invalid. */
export async function requireUser(req: Request): Promise<AuthUser> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw unauthorized()

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  )

  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw unauthorized('Your session has expired. Please log in again.')

  return { id: data.user.id, email: data.user.email ?? '' }
}

/**
 * Resolve the caller's membership of an organization and check their role.
 *
 * The organization is taken from the X-Organization-Id header, or falls back to
 * the caller's only membership when they have exactly one — so the common
 * single-group case never needs the header.
 */
export async function requireMember(
  req: Request,
  db: SupabaseClient,
  minRole: 'owner' | 'admin' | 'recorder' = 'recorder',
  explicitOrgId?: string,
): Promise<MemberContext> {
  const user = await requireUser(req)
  const headerOrg = explicitOrgId ?? req.headers.get('X-Organization-Id') ?? undefined

  let query = db
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (headerOrg) query = query.eq('organization_id', headerOrg)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  if (!data || data.length === 0) {
    // If they named an organization they are not a member of, do not confirm
    // that it exists.
    throw headerOrg ? notFound('Organization not found') : forbidden('You are not part of any football group yet')
  }
  if (!headerOrg && data.length > 1) {
    throw forbidden('Multiple groups found — specify which one with the X-Organization-Id header')
  }

  const membership = data[0]
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw forbidden(`This action requires ${minRole} permission`)
  }

  return { user, organizationId: membership.organization_id, role: membership.role }
}

/** Confirm a row belongs to the caller's organization before touching it. */
export async function assertOwned(
  db: SupabaseClient,
  table: string,
  id: string,
  organizationId: string,
): Promise<void> {
  const { data, error } = await db
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound()
}
