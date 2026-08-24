import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Spinner } from '@/components/ui'

/**
 * Route-level code splitting.
 *
 * The share page is the priority: it is opened from a WhatsApp link, on mobile
 * data, by people who will never sign in. It must not download the organizer's
 * dashboard, match-day recorder or settings screens to render a league table.
 * Only the landing and public pages are eager; everything else loads on demand.
 */
import { Landing } from '@/features/public/Landing'
import { PublicPageScreen, PublicPlayerScreen, PublicLiveSessionScreen } from '@/features/public/PublicPage'
import { JoinTeamScreen } from '@/features/onboarding/JoinTeam'

const GlobalLeaderboardScreen = lazy(() => import('@/features/public/GlobalLeaderboard').then((m) => ({ default: m.GlobalLeaderboardScreen })))

const LoginScreen = lazy(() => import('@/features/auth/screens').then((m) => ({ default: m.LoginScreen })))
const RegisterScreen = lazy(() => import('@/features/auth/screens').then((m) => ({ default: m.RegisterScreen })))
const VerifyEmailScreen = lazy(() => import('@/features/auth/screens').then((m) => ({ default: m.VerifyEmailScreen })))
const ForgotPasswordScreen = lazy(() => import('@/features/auth/screens').then((m) => ({ default: m.ForgotPasswordScreen })))
const ResetPasswordScreen = lazy(() => import('@/features/auth/screens').then((m) => ({ default: m.ResetPasswordScreen })))

const AppShell = lazy(() => import('@/components/layout/AppShell').then((m) => ({ default: m.AppShell })))
const Onboarding = lazy(() => import('@/features/onboarding/Onboarding').then((m) => ({ default: m.Onboarding })))
const Dashboard = lazy(() => import('@/features/stats/Dashboard').then((m) => ({ default: m.Dashboard })))
const PlayersScreen = lazy(() => import('@/features/players/screens').then((m) => ({ default: m.PlayersScreen })))
const PlayerProfileScreen = lazy(() => import('@/features/players/screens').then((m) => ({ default: m.PlayerProfileScreen })))
const SessionsScreen = lazy(() => import('@/features/sessions/screens').then((m) => ({ default: m.SessionsScreen })))
const NewSessionScreen = lazy(() => import('@/features/sessions/screens').then((m) => ({ default: m.NewSessionScreen })))
const SessionDetailScreen = lazy(() => import('@/features/sessions/screens').then((m) => ({ default: m.SessionDetailScreen })))
const MatchDayScreen = lazy(() => import('@/features/matchday/MatchDay').then((m) => ({ default: m.MatchDayScreen })))
const CompetitionsScreen = lazy(() => import('@/features/competitions/screens').then((m) => ({ default: m.CompetitionsScreen })))
const NewCompetitionScreen = lazy(() => import('@/features/competitions/screens').then((m) => ({ default: m.NewCompetitionScreen })))
const CompetitionDetailScreen = lazy(() => import('@/features/competitions/screens').then((m) => ({ default: m.CompetitionDetailScreen })))
const CompetitionMatchDayScreen = lazy(() => import('@/features/competitions/CompetitionMatchDay').then((m) => ({ default: m.CompetitionMatchDayScreen })))
const LeaderboardScreen = lazy(() => import('@/features/leaderboard/Leaderboard').then((m) => ({ default: m.LeaderboardScreen })))
const AwardsScreen = lazy(() => import('@/features/awards/Awards').then((m) => ({ default: m.AwardsScreen })))
const SettingsLayout = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.SettingsLayout })))
const ScheduleSettings = lazy(() => import('@/features/settings/Schedule').then((m) => ({ default: m.ScheduleSettings })))
const GeneralSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.GeneralSettings })))
const FootballSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.FootballSettings })))
const ScoringSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.ScoringSettings })))
const CompetitionSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.CompetitionSettings })))
const ShareSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.ShareSettings })))
const MembersSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.MembersSettings })))
const AccountSettings = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.AccountSettings })))
const JoinScreen = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.JoinScreen })))

function Booting() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="h-6 w-6 text-chalk-muted" />
    </div>
  )
}

/** Signed-in users only. Anyone without a group goes to onboarding first. */
function Protected({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, needsOnboarding } = useAuth()
  if (loading) return <Booting />
  if (!authenticated) return <Navigate to="/login" replace />
  if (needsOnboarding) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

/** Signed-out users only — bounce anyone already in straight to the app. */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useAuth()
  if (loading) return <Booting />
  if (authenticated) return <Navigate to="/app" replace />
  return <>{children}</>
}

export function Router() {
  const { loading, authenticated, needsOnboarding } = useAuth()

  return (
    <Suspense fallback={<Booting />}>
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/t/:slug" element={<PublicPageScreen />} />
      <Route path="/t/:slug/player/:playerId" element={<PublicPlayerScreen />} />
      <Route path="/t/:slug/live/:sessionId" element={<PublicLiveSessionScreen />} />
      <Route path="/leaderboard" element={<GlobalLeaderboardScreen />} />
      <Route path="/join/:token" element={<JoinScreen />} />
      <Route path="/play/:slug" element={<JoinTeamScreen />} />

      {/* Auth */}
      <Route path="/login" element={<GuestOnly><LoginScreen /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterScreen /></GuestOnly>} />
      <Route path="/verify-email" element={<VerifyEmailScreen />} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordScreen /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />

      {/* Onboarding sits between auth and the app: signed in, but no group yet. */}
      <Route
        path="/onboarding"
        element={
          loading ? <Booting />
            : !authenticated ? <Navigate to="/login" replace />
            // needsOnboarding flips false the instant a group is created
            // (step 1 of 4) — the sessionStorage flag keeps the wizard from
            // being kicked to /app mid-flow while steps 2-4 still run.
            : (!needsOnboarding && !sessionStorage.getItem('tb_onboarding_active')) ? <Navigate to="/app" replace />
            : <Onboarding />
        }
      />

      {/* Match day renders outside the shell — no tab bar competing for the thumb. */}
      <Route path="/app/sessions/:id/live" element={<Protected><MatchDayScreen /></Protected>} />
      <Route path="/app/competitions/:id/fixtures/:fixtureId/live" element={<Protected><CompetitionMatchDayScreen /></Protected>} />

      {/* App */}
      <Route path="/app" element={<Protected><AppShell /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="players" element={<PlayersScreen />} />
        <Route path="players/:id" element={<PlayerProfileScreen />} />
        <Route path="sessions" element={<SessionsScreen />} />
        <Route path="sessions/new" element={<NewSessionScreen />} />
        <Route path="sessions/:id" element={<SessionDetailScreen />} />
        <Route path="competitions" element={<CompetitionsScreen />} />
        <Route path="competitions/new" element={<NewCompetitionScreen />} />
        <Route path="competitions/:id" element={<CompetitionDetailScreen />} />
        <Route path="leaderboard" element={<LeaderboardScreen />} />
        <Route path="awards" element={<AwardsScreen />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<GeneralSettings />} />
          <Route path="schedule" element={<ScheduleSettings />} />
          <Route path="football" element={<FootballSettings />} />
          <Route path="scoring" element={<ScoringSettings />} />
          <Route path="competitions" element={<CompetitionSettings />} />
          <Route path="share" element={<ShareSettings />} />
          <Route path="members" element={<MembersSettings />} />
          <Route path="account" element={<AccountSettings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
