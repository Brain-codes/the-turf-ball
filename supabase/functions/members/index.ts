/** /members — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { listMembers, inviteMember, updateMember, removeMember } from './handlers/members.ts'

Deno.serve(createRouter('members', {
  GET: {
    '': listMembers,
  },
  POST: {
    '': inviteMember,
  },
  PATCH: {
    ':id': updateMember,
  },
  DELETE: {
    ':id': removeMember,
  },
}))
