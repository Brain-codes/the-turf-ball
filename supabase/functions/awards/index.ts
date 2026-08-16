/** /awards — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listAwards, awardHistory } from './handlers/awards.ts'

Deno.serve(createRouter('awards', {
  GET: {
    '': listAwards,
    'history': awardHistory,
  },
}))
