/** /organizations — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listOrganizations } from './handlers/list.ts'
import { createOrganization } from './handlers/create.ts'
import { getOrganization } from './handlers/get.ts'
import { updateOrganization } from './handlers/update.ts'
import { getSettings, updateSettings } from './handlers/settings.ts'
import { updatePublicPage } from './handlers/publicPage.ts'
import { slugCheck } from './handlers/slugCheck.ts'
import { listSlots, upcomingSlots, createSlot, updateSlot, deleteSlot } from './handlers/slots.ts'

Deno.serve(createRouter('organizations', {
  GET: {
    '': listOrganizations,
    'slug-check': slugCheck,
    ':id': getOrganization,
    ':id/settings': getSettings,
    ':id/slots': listSlots,
    ':id/slots/upcoming': upcomingSlots,
  },
  POST: {
    '': createOrganization,
    ':id/slots': createSlot,
  },
  PATCH: {
    ':id': updateOrganization,
    ':id/settings': updateSettings,
    ':id/public-page': updatePublicPage,
    ':id/slots/:slotId': updateSlot,
  },
  DELETE: {
    ':id/slots/:slotId': deleteSlot,
  },
}))
