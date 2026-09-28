import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'

/** Everything finance lives under one key, so one invalidate refreshes it all. */
export function useFinanceRefresh() {
  const qc = useQueryClient()
  const { activeOrg } = useAuth()
  return () => qc.invalidateQueries({ queryKey: ['finance', activeOrg?.id] })
}

/** Money is for the group's owner and admins only. */
export function useIsFinanceAdmin() {
  const { activeOrg } = useAuth()
  return activeOrg?.role === 'owner' || activeOrg?.role === 'admin'
}
