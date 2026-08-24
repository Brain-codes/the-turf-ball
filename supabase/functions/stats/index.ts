/** /stats — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { leaderboard } from './handlers/leaderboard.ts'
import { dashboard } from './handlers/dashboard.ts'
import { statsBreakdown } from './handlers/breakdown.ts'

Deno.serve(createRouter('stats', {
  GET: {
    'leaderboard': leaderboard,
    'dashboard': dashboard,
    ':player_id/breakdown': statsBreakdown,
  },
}))
