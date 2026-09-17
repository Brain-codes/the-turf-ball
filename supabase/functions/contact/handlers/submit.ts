/**
 * POST /contact — store a message from the public contact form.
 *
 * Spam defence, cheapest check first:
 *  1. Body size cap — nothing large is ever parsed.
 *  2. Honeypot — a field real people never see. Bots that fill it get a
 *     normal-looking success and nothing is saved.
 *  3. Time on form — the form fetches a server-signed timestamp when it opens
 *     (GET /contact/token). Missing, forged, under 3 seconds old or over a
 *     day old means a bot or a replay. Server time only, so clock skew on
 *     the visitor's device can't matter.
 *  4. Content rules — length limits, at most 2 links, no HTML.
 *  5. Rate limits — per sender (hashed IP), per email address, and a global
 *     daily ceiling so a distributed flood can't fill the table.
 *  6. Duplicates — the same message from the same email in 24 h is dropped.
 *
 * Nothing here is ever rendered as HTML, and the table can only be read with
 * the service role, so a stored message can't attack anyone.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { badRequest, tooMany } from '../../_shared/errors.ts'
import { email, oneOf, required, str, validate } from '../../_shared/validation.ts'
import { requireFeature } from '../../_shared/features.ts'

const TOPICS = ['question', 'suggestion', 'bug', 'partnership', 'other'] as const
const MAX_BODY_BYTES = 16_000
const MIN_FILL_MS = 3_000
const MAX_FILL_MS = 24 * 60 * 60 * 1000
const PER_IP_HOUR = 3
const PER_IP_DAY = 8
const PER_EMAIL_DAY = 3
const GLOBAL_DAY = 300

const ok = () => successResponse({}, 'Thanks — your message has been sent.')

async function hmac(data: string): Promise<string> {
  const secret = Deno.env.get('CONTACT_IP_SALT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`form:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** GET /contact/token — a signed "form opened at" stamp. */
export async function issueToken(): Promise<Response> {
  const issued = String(Date.now())
  return successResponse({ token: `${issued}.${await hmac(issued)}` })
}

async function tokenAge(token: unknown): Promise<number | null> {
  if (typeof token !== 'string' || token.length > 200) return null
  const [issued, sig] = token.split('.')
  if (!issued || !sig || !/^\d{10,16}$/.test(issued)) return null
  if ((await hmac(issued)) !== sig) return null
  return Date.now() - Number(issued)
}

async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get('CONTACT_IP_SALT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const bytes = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

async function countSince(ctx: Ctx, column: 'ip_hash' | 'email' | null, value: string | null, sinceMs: number) {
  let q = ctx.db
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - sinceMs).toISOString())
  if (column === 'ip_hash') q = q.eq('ip_hash', value!)
  if (column === 'email') q = q.eq('email', value!)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function submitMessage(ctx: Ctx): Promise<Response> {
  await requireFeature(ctx.db, 'contact_form', 'The contact form is switched off right now.')

  const length = Number(ctx.req.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw badRequest('That message is too long')

  const body = await ctx.body<Record<string, unknown>>()

  // 2. Honeypot.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    ctx.log.warn('contact: honeypot filled')
    return ok()
  }

  // 3. Time on form.
  const elapsed = await tokenAge(body.form_token)
  if (elapsed === null || elapsed < MIN_FILL_MS || elapsed > MAX_FILL_MS) {
    ctx.log.warn('contact: suspicious fill time', { elapsed })
    throw badRequest('Please take a moment and try sending again')
  }

  // 4. Content.
  validate(body, {
    name: [required, str(1, 80)],
    email: [required, email, str(3, 254)],
    topic: [required, oneOf(TOPICS)],
    message: [required, str(10, 2000)],
  })

  const name = String(body.name).trim()
  const address = String(body.email).trim().toLowerCase()
  const message = String(body.message).trim()

  const links = message.match(/https?:\/\/|www\./gi)?.length ?? 0
  if (links > 2) throw badRequest('Please include no more than 2 links')
  if (/<[a-z/][^>]*>/i.test(message) || /<[a-z/][^>]*>/i.test(name)) {
    throw badRequest('Please send plain text only')
  }

  // 5. Rate limits.
  const ipHash = await hashIp(clientIp(ctx.req))
  const [ipHour, ipDay, emailDay, globalDay] = await Promise.all([
    countSince(ctx, 'ip_hash', ipHash, 60 * 60 * 1000),
    countSince(ctx, 'ip_hash', ipHash, 24 * 60 * 60 * 1000),
    countSince(ctx, 'email', address, 24 * 60 * 60 * 1000),
    countSince(ctx, null, null, 24 * 60 * 60 * 1000),
  ])
  if (ipHour >= PER_IP_HOUR || ipDay >= PER_IP_DAY || emailDay >= PER_EMAIL_DAY) {
    throw tooMany('You have sent a few messages already. Please try again later.')
  }
  if (globalDay >= GLOBAL_DAY) {
    ctx.log.error('contact: global daily cap reached')
    throw tooMany('We are getting a lot of messages right now. Please try again tomorrow.')
  }

  // 6. Duplicates.
  const { data: dupe, error: dupeErr } = await ctx.db
    .from('contact_messages')
    .select('id')
    .eq('email', address)
    .eq('message', message)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle()
  if (dupeErr) throw new Error(dupeErr.message)
  if (dupe) return ok()

  const { error } = await ctx.db.from('contact_messages').insert({
    name,
    email: address,
    topic: body.topic,
    message,
    ip_hash: ipHash,
    user_agent: ctx.req.headers.get('user-agent')?.slice(0, 300) ?? null,
  })
  if (error) throw new Error(error.message)

  ctx.log.info('contact: message stored', { topic: body.topic })
  return ok()
}
