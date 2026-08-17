/** /matches — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { createMatch } from './handlers/create.ts'
import { getMatch } from './handlers/get.ts'
import { startMatch, finishMatch, resumeMatch, updateRoster } from './handlers/lifecycle.ts'

Deno.serve(createRouter('matches', {
  GET: {
    ':id': getMatch,
  },
  POST: {
    '': createMatch,
    ':id/start': startMatch,
    ':id/finish': finishMatch,
    ':id/resume': resumeMatch,
  },
  PATCH: {
    ':id/roster': updateRoster,
  },
}))
