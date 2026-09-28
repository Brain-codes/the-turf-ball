/**
 * /finance — router only. rule2.txt §7.
 *
 * Group finances: subscriptions, game fees, payments and who owes what.
 * Owner/admin only, and only for groups that have switched it on.
 */

import { createRouter } from '../_shared/router.ts'
import { activity, overview } from './handlers/overview.ts'
import { updateSettings } from './handlers/settings.ts'
import { getPlayer, updatePlayer } from './handlers/players.ts'
import { addCharge, addCredit, recordPayment, recordSubscription, sessionFees, voidEntry } from './handlers/entries.ts'

Deno.serve(createRouter('finance', {
  GET: {
    'overview': overview,
    'activity': activity,
    'players/:id': getPlayer,
    'sessions/:id': sessionFees,
  },
  POST: {
    'payments': recordPayment,
    'charges': addCharge,
    'credits': addCredit,
    'subscriptions': recordSubscription,
    'entries/:id/void': voidEntry,
  },
  PATCH: {
    'settings': updateSettings,
    'players/:id': updatePlayer,
  },
}))
