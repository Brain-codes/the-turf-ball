/**
 * Contact form inbox.
 */

import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { requireSuperAdmin } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { oneOf, required, uuid, validate } from '../../_shared/validation.ts'
import { pageParams } from '../../_shared/helpers.ts'
import { logAction } from './_log.ts'

const STATUSES = ['new', 'read', 'replied', 'spam'] as const

export async function listMessages(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const status = ctx.query.get('status')

  let q = ctx.db
    .from('contact_messages')
    .select('id, name, email, topic, message, status, created_at', { count: 'exact' })
  if (status && (STATUSES as readonly string[]).includes(status)) q = q.eq('status', status)
  else q = q.neq('status', 'spam')

  const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, to)
  if (error) throw new Error(error.message)
  return successResponse(data ?? [], 'Request successful', paginate(page, perPage, count ?? 0))
}

export async function updateMessage(ctx: Ctx): Promise<Response> {
  const admin = await requireSuperAdmin(ctx.req, ctx.db)
  const id = ctx.segments[1]
  const body = await ctx.body<Record<string, unknown>>()
  validate({ ...body, id }, { id: [required, uuid], status: [required, oneOf(STATUSES)] })

  const { data, error } = await ctx.db
    .from('contact_messages')
    .update({ status: body.status })
    .eq('id', id)
    .select('id, status')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Message not found')

  await logAction(ctx.db, admin.id, `message.${body.status}`, 'contact_message', id)
  return successResponse(data, 'Message updated')
}
