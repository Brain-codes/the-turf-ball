/**
 * /public — router only. rule2.txt §7.
 *
 * The only unauthenticated function in the project. It has no write path.
 */

import { createRouter } from '../_shared/router.ts'
import { getPublicPage, getPublicPlayer, getPublicSession } from './handlers/publicPage.ts'

Deno.serve(createRouter('public', {
  GET: {
    ':slug': getPublicPage,
    ':slug/player/:playerId': getPublicPlayer,
    ':slug/session/:sessionId': getPublicSession,
  },
}))
