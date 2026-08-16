/**
 * Registration. This goes through an Edge Function rather than the client SDK
 * because it is a compound operation (rule2.txt §12): create the auth user,
 * create the profile, and — on failure at any point — leave nothing behind.
 *
 * It deliberately uses the ANON client's signUp() rather than the admin API.
 * admin.createUser() does not send Supabase's native confirmation email, and
 * rule2.txt §14 rules out every third-party mail provider. signUp() is the only
 * path that triggers the built-in verification email.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { conflict, tooMany } from '../../_shared/errors.ts'
import { email, required, str, validate } from '../../_shared/validation.ts'

interface Body {
  email: string
  password: string
  full_name: string
}

export async function register(ctx: Ctx): Promise<Response> {
  const body = await ctx.body<Body>()
  validate(body as unknown as Record<string, unknown>, {
    email: [required, email],
    password: [required, str(8, 72)],
    full_name: [required, str(2, 80)],
  })

  const normalizedEmail = body.email.trim().toLowerCase()
  const fullName = body.full_name.trim()

  // Check profiles first so we can give a clear message. Supabase deliberately
  // returns an obfuscated success for an existing email, which would otherwise
  // leave the user staring at a confirmation screen for an account they
  // already have.
  const { data: existing } = await ctx.db
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existing) {
    throw conflict('An account with this email already exists. Try logging in instead.')
  }

  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: signUpData, error: signUpError } = await anon.auth.signUp({
    email: normalizedEmail,
    password: body.password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: Deno.env.get('SITE_URL')
        ? `${Deno.env.get('SITE_URL')}/verify-email`
        : undefined,
    },
  })

  if (signUpError || !signUpData.user) {
    if (signUpError?.message?.toLowerCase().includes('already')) {
      throw conflict('An account with this email already exists. Try logging in instead.')
    }
    // Supabase's built-in email sender has a low, shared rate limit. Surface
    // this as a clear, temporary condition rather than a generic 500 — it's
    // not a bug, it's the mail provider throttling.
    if (signUpError?.message?.toLowerCase().includes('rate limit')) {
      throw tooMany('Too many signups right now. Please wait a few minutes and try again.')
    }
    throw new Error(signUpError?.message ?? 'Could not create the account')
  }

  const userId = signUpData.user.id

  const { error: profileError } = await ctx.db.from('profiles').insert({
    id: userId,
    email: normalizedEmail,
    full_name: fullName,
  })

  if (profileError) {
    // Roll back the auth user so the email address is not left half-registered
    // and permanently unusable.
    await ctx.db.auth.admin.deleteUser(userId)
    ctx.log.error('profile insert failed, auth user rolled back', { error: profileError.message })
    throw new Error('Could not finish creating the account. Please try again.')
  }

  // If an invitation is waiting for this email, attach it now so the invitee
  // lands straight in the group instead of being asked to create their own.
  await ctx.db
    .from('organization_members')
    .update({ user_id: userId, status: 'active' })
    .eq('invited_email', normalizedEmail)
    .eq('status', 'invited')

  ctx.log.info('user registered', { user_id: userId })

  return successResponse(
    {
      user_id: userId,
      email: normalizedEmail,
      email_confirmation_required: !signUpData.session,
    },
    'Account created. Check your email to confirm your address.',
    {},
    201,
  )
}
