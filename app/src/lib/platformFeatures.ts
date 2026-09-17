import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/client'

export type PlatformFeature = 'new_groups' | 'public_tables' | 'head_to_head' | 'self_join_links' | 'contact_form'

/**
 * Which features the super admin has switched on. Anything unknown — or the
 * request failing — counts as on; the server enforces the real switch.
 */
export function usePlatformFeatures() {
  const { data } = useQuery({
    queryKey: ['platform-features'],
    queryFn: async () => (await api.public<Partial<Record<PlatformFeature, boolean>>>('public/features')).data,
    staleTime: 5 * 60_000,
  })
  return (key: PlatformFeature) => data?.[key] !== false
}
