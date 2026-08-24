/** /competitions — router only. rule2.txt §7. */

import { createRouter } from '../_shared/router.ts'
import { createCompetition } from './handlers/create.ts'
import { listCompetitions, getCompetition } from './handlers/list.ts'
import { updateCompetition, cancelCompetition, setStatsToggle } from './handlers/update.ts'
import { addCompetitionPlayer, removeCompetitionPlayer } from './handlers/players.ts'
import { draftCompetition } from './handlers/draft.ts'
import { updateTeam, addTeamPlayer, removeTeamPlayer } from './handlers/teams.ts'
import { generateFixtures, listFixtures, updateFixture } from './handlers/fixtures.ts'
import { startFixture } from './handlers/start.ts'
import { getStandings } from './handlers/standings.ts'
import { getTeamBalance } from './handlers/balance.ts'
import { setFixtureAttendance } from './handlers/attendance.ts'

Deno.serve(createRouter('competitions', {
  GET: {
    '': listCompetitions,
    ':id': getCompetition,
    ':id/fixtures': listFixtures,
    ':id/standings': getStandings,
    ':id/balance': getTeamBalance,
  },
  POST: {
    '': createCompetition,
    ':id/cancel': cancelCompetition,
    ':id/players': addCompetitionPlayer,
    ':id/draft': draftCompetition,
    ':id/teams/:team_id/players': addTeamPlayer,
    ':id/rounds': generateFixtures,
    ':id/fixtures/:fixture_id/start': startFixture,
    ':id/fixtures/:fixture_id/attendance': setFixtureAttendance,
  },
  PATCH: {
    ':id': updateCompetition,
    ':id/stats-toggle': setStatsToggle,
    ':id/teams/:team_id': updateTeam,
    ':id/fixtures/:fixture_id': updateFixture,
  },
  DELETE: {
    ':id/players/:player_id': removeCompetitionPlayer,
    ':id/teams/:team_id/players/:player_id': removeTeamPlayer,
  },
}))
