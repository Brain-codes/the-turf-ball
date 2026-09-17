/**
 * /public — router only. rule2.txt §7.
 *
 * The only unauthenticated function in the project. It has exactly one
 * write path — `POST :slug/join`, the self-serve player invite
 * (publicJoin.ts) — deliberately narrow: it can only ever insert a
 * `players` row with status = 'pending', nothing else, and an admin must
 * approve it before it becomes a real roster member. Every other route
 * here stays read-only.
 */

import { createRouter } from '../_shared/router.ts'
import { getPublicPage, getPublicPlayer, getPublicSession } from './handlers/publicPage.ts'
import { joinTeam } from './handlers/publicJoin.ts'
import { getGlobalPlayers, getGlobalTeams } from './handlers/globalLeaderboard.ts'
import { publicH2H, publicH2HPlayers, publicH2HTeams } from './handlers/headToHead.ts'

Deno.serve(createRouter('public', {
  GET: {
    'leaderboard/players': getGlobalPlayers,
    'leaderboard/teams': getGlobalTeams,
    'h2h': publicH2H,
    'h2h/teams': publicH2HTeams,
    'h2h/players': publicH2HPlayers,
    ':slug': getPublicPage,
    ':slug/player/:playerId': getPublicPlayer,
    ':slug/session/:sessionId': getPublicSession,
  },
  POST: {
    ':slug/join': joinTeam,
  },
}))
