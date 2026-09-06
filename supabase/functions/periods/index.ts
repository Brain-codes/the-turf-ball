/** /periods — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listPeriods, previewClose, closePeriod, reopenPeriod } from './handlers/periods.ts'
import { periodReport, rebuildReport, repairSessionMonths } from './handlers/report.ts'

Deno.serve(createRouter('periods', {
  GET: {
    '': listPeriods,
    ':id/preview-close': previewClose,
    ':id/report': periodReport,
  },
  POST: {
    ':id/close': closePeriod,
    ':id/reopen': reopenPeriod,
    ':id/report/rebuild': rebuildReport,
    'repair-sessions': repairSessionMonths,
  },
}))
