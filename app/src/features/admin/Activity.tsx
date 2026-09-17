import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/client'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { AdminHeader, Pager, when, type PageMeta } from './shared'

type Action = {
  id: string
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
  admin: { email: string } | null
}

const LABELS: Record<string, string> = {
  'group.suspend': 'Suspended a group',
  'group.restore': 'Restored a group',
  'user.block': 'Blocked an account',
  'user.unblock': 'Unblocked an account',
  'user.make_admin': 'Made someone super admin',
  'user.remove_admin': 'Removed a super admin',
  'feature.on': 'Switched a feature on',
  'feature.off': 'Switched a feature off',
  'message.read': 'Marked a message read',
  'message.replied': 'Replied to a message',
  'message.spam': 'Marked a message as spam',
  'message.new': 'Marked a message unread',
}

function subject(a: Action) {
  const d = a.details
  return String(d.name ?? d.email ?? d.label ?? '')
}

export function AdminActivity() {
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'actions', page],
    queryFn: async () => {
      const r = await api.get<Action[]>('admin/actions', { page, per_page: 30 })
      return { rows: r.data, meta: r.meta as unknown as PageMeta }
    },
  })

  return (
    <>
      <AdminHeader title="Activity" subtitle="Every change made from this admin area, newest first." />
      {isLoading && <Skeleton className="h-80" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {data && data.rows.length === 0 && <EmptyState icon="🕘" title="No admin changes yet" />}
      {data && data.rows.length > 0 && (
        <ol className="surface divide-y divide-pitch-800">
          {data.rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3.5 text-[14px]">
              <span>
                <span className="text-chalk">{LABELS[a.action] ?? a.action}</span>
                {subject(a) && <span className="text-chalk-muted"> · {subject(a)}</span>}
                {typeof a.details.reason === 'string' && a.details.reason && <span className="text-chalk-faint"> ({a.details.reason})</span>}
              </span>
              <span className="text-[12.5px] text-chalk-faint">{a.admin?.email ?? 'unknown'} · {when(a.created_at)}</span>
            </li>
          ))}
        </ol>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </>
  )
}
