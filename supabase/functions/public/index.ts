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
import { listFeatures } from './handlers/features.ts'
import { requireFeature, type FeatureKey } from '../_shared/features.ts'
import type { Handler } from '../_shared/router.ts'

/** Wrap a handler so it answers 503 while its feature is switched off. */
const gated = (key: FeatureKey, message: string, handler: Handler): Handler => async (ctx) => {
  await requireFeature(ctx.db, key, message)
  return handler(ctx)
}

const TABLES_OFF = 'Public tables are switched off right now.'
const H2H_OFF = 'Head-to-head is switched off right now.'

Deno.serve(createRouter('public', {
  GET: {
    'features': listFeatures,
    'leaderboard/players': gated('public_tables', TABLES_OFF, getGlobalPlayers),
    'leaderboard/teams': gated('public_tables', TABLES_OFF, getGlobalTeams),
    'h2h': gated('head_to_head', H2H_OFF, publicH2H),
    'h2h/teams': gated('head_to_head', H2H_OFF, publicH2HTeams),
    'h2h/players': gated('head_to_head', H2H_OFF, publicH2HPlayers),
    ':slug': getPublicPage,
    ':slug/player/:playerId': getPublicPlayer,
    ':slug/session/:sessionId': getPublicSession,
  },
  POST: {
    ':slug/join': gated('self_join_links', 'Invite links are switched off right now. Ask your organiser to add you.', joinTeam),
  },
}))
