/** /periods — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listPeriods, previewClose, closePeriod, reopenPeriod } from './handlers/periods.ts'

Deno.serve(createRouter('periods', {
  GET: {
    '': listPeriods,
    ':id/preview-close': previewClose,
  },
  POST: {
    ':id/close': closePeriod,
    ':id/reopen': reopenPeriod,
  },
}))
