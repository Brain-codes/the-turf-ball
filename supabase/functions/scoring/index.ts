/** /scoring — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { getRules, updateRules, getPresets } from './handlers/rules.ts'

Deno.serve(createRouter('scoring', {
  GET: {
    'rules': getRules,
    'presets': getPresets,
  },
  PUT: {
    'rules': updateRules,
  },
}))
