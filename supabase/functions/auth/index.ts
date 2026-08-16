/**
 * /auth — router only. rule2.txt §7.
 *
 * Login, logout and password reset are NOT here: rule2.txt §11 permits those
 * through the Supabase Auth SDK directly, and routing them through a function
 * would add a hop for nothing.
 */

import { createRouter } from '../_shared/router.ts'
import { register } from './handlers/register.ts'
import { me } from './handlers/me.ts'
import { updateProfile } from './handlers/updateProfile.ts'
import { resendVerification } from './handlers/resendVerification.ts'
import { acceptInvite } from './handlers/acceptInvite.ts'
import { confirmDeleteAccount, previewDeleteAccount } from './handlers/deleteAccount.ts'

Deno.serve(createRouter('auth', {
  GET: {
    'me': me,
    'delete-account': previewDeleteAccount,
  },
  POST: {
    'register': register,
    'resend-verification': resendVerification,
    'accept-invite': acceptInvite,
    'delete-account': confirmDeleteAccount,
  },
  PATCH: {
    'me': updateProfile,
  },
}))
