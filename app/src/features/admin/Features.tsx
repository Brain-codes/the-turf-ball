import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/client'
import { ErrorState, Skeleton, Toggle } from '@/components/ui'
import { AdminHeader, confirmAction, when } from './shared'

type Feature = {
  key: string
  label: string
  description: string
  enabled: boolean
  updated_at: string
  updated_by: { email: string } | null
}

export function AdminFeatures() {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'features'],
    queryFn: async () => (await api.get<Feature[]>('admin/features')).data,
  })

  const update = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => api.patch(`admin/features/${key}`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] })
      qc.invalidateQueries({ queryKey: ['platform-features'] })
    },
  })

  const flip = (f: Feature) => {
    if (f.enabled && !confirmAction(`Switch off “${f.label}” for everyone on The Turf Ball?`)) return
    update.mutate({ key: f.key, enabled: !f.enabled })
  }

  return (
    <>
      <AdminHeader title="Features" subtitle="Switch platform features on or off for everyone. Changes apply straight away." />
      {isLoading && <Skeleton className="h-72" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {update.error && <p role="alert" className="mb-4 text-[14px] text-card-red">{(update.error as Error).message}</p>}
      {data && (
        <ul className="surface divide-y divide-pitch-800">
          {data.map((f) => (
            <li key={f.key} className="px-5 py-2">
              <Toggle
                checked={f.enabled}
                onChange={() => flip(f)}
                disabled={update.isPending}
                label={f.label}
                description={`${f.description} ${f.enabled ? 'On' : 'Off'} · changed ${when(f.updated_at)}${f.updated_by ? ` by ${f.updated_by.email}` : ''}.`}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
