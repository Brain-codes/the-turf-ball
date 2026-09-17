/**
 * /admin — router only. rule2.txt §7.
 *
 * Platform super admin. Every handler starts with requireSuperAdmin(), which
 * answers 404 to anyone else, so the API doesn't even admit it exists.
 */

import { createRouter } from '../_shared/router.ts'
import { overview } from './handlers/overview.ts'
import { getOrganization, listOrganizations, updateOrganization } from './handlers/organizations.ts'
import { listUsers, updateUser } from './handlers/users.ts'
import { listFeatures, updateFeature } from './handlers/features.ts'
import { listMessages, updateMessage } from './handlers/messages.ts'
import { listActions } from './handlers/actions.ts'

Deno.serve(createRouter('admin', {
  GET: {
    'overview': overview,
    'organizations': listOrganizations,
    'organizations/:id': getOrganization,
    'users': listUsers,
    'features': listFeatures,
    'messages': listMessages,
    'actions': listActions,
  },
  PATCH: {
    'organizations/:id': updateOrganization,
    'users/:id': updateUser,
    'features/:key': updateFeature,
    'messages/:id': updateMessage,
  },
}))
