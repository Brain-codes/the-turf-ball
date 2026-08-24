/** /sessions — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listSessions } from './handlers/list.ts'
import { createSession } from './handlers/create.ts'
import { getSession } from './handlers/get.ts'
import { updateSession } from './handlers/update.ts'
import { setAttendance, startSession, completeSession, keepAlive, resumeSession } from './handlers/attendance.ts'
import { approveSession } from './handlers/approve.ts'

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
    ':id/keep-alive': keepAlive,
    ':id/resume': resumeSession,
    ':id/approve': approveSession,
  },
  PATCH: {
    ':id': updateSession,
  },
}))
