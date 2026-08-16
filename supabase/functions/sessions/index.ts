/** /sessions — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listSessions } from './handlers/list.ts'
import { createSession } from './handlers/create.ts'
import { getSession } from './handlers/get.ts'
import { updateSession } from './handlers/update.ts'
import { setAttendance, startSession, completeSession } from './handlers/attendance.ts'

Deno.serve(createRouter('sessions', {
  GET: {
    '': listSessions,
    ':id': getSession,
  },
  POST: {
    '': createSession,
    ':id/attendance': setAttendance,
    ':id/start': startSession,
    ':id/complete': completeSession,
  },
  PATCH: {
    ':id': updateSession,
  },
}))
