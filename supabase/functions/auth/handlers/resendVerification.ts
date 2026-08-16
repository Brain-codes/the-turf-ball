import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { email, required, validate } from '../../_shared/validation.ts'

export async function resendVerification(ctx: Ctx): Promise<Response> {
  const body = await ctx.body<{ email: string }>()
  validate(body as unknown as Record<string, unknown>, { email: [required, email] })

  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false } },
  )

  await anon.auth.resend({ type: 'signup', email: body.email.trim().toLowerCase() })

  // Always report success. Confirming which addresses are registered would let
  // anyone enumerate the user list.
  return successResponse({}, 'If that address needs confirming, we have sent a new link.')
}
