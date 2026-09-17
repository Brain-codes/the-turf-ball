import { useAuth } from '@/features/auth/AuthProvider'

/**
 * Where "the account button" on public pages should go. Signed-in people get
 * sent to their dashboard (or back into setup), never to sign-up again.
 */
export function useAccountLink() {
  const { loading, authenticated, needsOnboarding } = useAuth()
  if (loading) return { state: 'loading' as const }
  if (!authenticated) return { state: 'guest' as const }
  return needsOnboarding
    ? { state: 'member' as const, to: '/onboarding', label: 'Finish setting up' }
    : { state: 'member' as const, to: '/app', label: 'Go to dashboard' }
}
