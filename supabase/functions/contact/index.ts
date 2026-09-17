/**
 * /contact — router only. rule2.txt §7.
 *
 * Unauthenticated, write-only: the public contact form. It can insert one
 * row into contact_messages, plus hand out the signed form token. There is
 * no route that reads messages back.
 */

import { createRouter } from '../_shared/router.ts'
import { issueToken, submitMessage } from './handlers/submit.ts'

Deno.serve(createRouter('contact', {
  GET: {
    'token': issueToken,
  },
  POST: {
    '': submitMessage,
  },
}))
