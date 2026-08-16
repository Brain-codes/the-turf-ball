/** /players — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listPlayers } from './handlers/list.ts'
import { createPlayer } from './handlers/create.ts'
import { bulkCreatePlayers } from './handlers/bulkCreate.ts'
import { getPlayer } from './handlers/get.ts'
import { updatePlayer } from './handlers/update.ts'
import { removePlayer } from './handlers/remove.ts'

Deno.serve(createRouter('players', {
  GET: {
    '': listPlayers,
    ':id': getPlayer,
  },
  POST: {
    '': createPlayer,
    'bulk': bulkCreatePlayers,
  },
  PATCH: {
    ':id': updatePlayer,
  },
  DELETE: {
    ':id': removePlayer,
  },
}))
