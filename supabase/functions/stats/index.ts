/** /stats — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { leaderboard } from './handlers/leaderboard.ts'
import { dashboard } from './handlers/dashboard.ts'
import { statsBreakdown } from './handlers/breakdown.ts'
import { memberH2H, memberH2HPlayers, memberH2HTeams } from './handlers/headToHead.ts'

Deno.serve(createRouter('stats', {
  GET: {
    'leaderboard': leaderboard,
    'dashboard': dashboard,
    ':player_id/breakdown': statsBreakdown,
    'h2h': memberH2H,
    'h2h/teams': memberH2HTeams,
    'h2h/players': memberH2HPlayers,
  },
}))
