/** /events — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { recordEvent, recordBatch, voidEvent, listEvents } from './handlers/record.ts'

Deno.serve(createRouter('events', {
  GET: {
    '': listEvents,
  },
  POST: {
    '': recordEvent,
    'batch': recordBatch,
  },
  DELETE: {
    ':id': voidEvent,
  },
}))
