/**
 * Super admin → Storage. Every group at a glance, then the exact same
 * storage screen the group sees for itself (StoragePanel), for any group.
 */

import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { RiArrowLeftLine, RiArrowRightSLine, RiExternalLinkLine } from '@remixicon/react'
import { api } from '@/services/client'
import { ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { StoragePanel } from '@/features/gallery/storage/StoragePanel'
import { formatBytes } from '@/features/gallery/shared/media'
import { AdminHeader, StatusPill, useSearch } from './shared'

type Row = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  gallery_enabled: boolean
  status: string
  accounts: number
  full: number
  errors: number
  active_pct: number | null
  storage_bytes: number
}

export function AdminStorage() {
  const { term, box } = useSearch()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'storage'],
    queryFn: async () => (await api.get<Row[]>('gallery/storage')).data,
  })
  const rows = (data ?? []).filter((r) => !term || r.name.toLowerCase().includes(term.toLowerCase()))
  rows.sort((a, b) => Number(b.gallery_enabled) - Number(a.gallery_enabled) || b.accounts - a.accounts)

  return (
    <>
      <AdminHeader title="Storage" subtitle="Galleries and Cloudinary accounts for every group. Open a group to see what they see." action={box} />
      {isLoading && <Skeleton className="h-72" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {data && (
        <ul className="surface divide-y divide-pitch-800">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/admin/storage/${r.id}`} className="flex min-h-16 items-center gap-4 px-5 py-3 hover:bg-pitch-800/50">
                {r.logo_url ? <img src={r.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-pitch-700" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{r.name}</p>
                  <p className="text-[12.5px] text-chalk-muted">
                    {r.accounts} account{r.accounts === 1 ? '' : 's'}{r.accounts ? ` · ${formatBytes(r.storage_bytes)} stored` : ''}
                    {r.full ? ` · ${r.full} full` : ''}{r.errors ? ` · ${r.errors} with bad keys` : ''}
                  </p>
                </div>
                {r.active_pct != null && (
                  <div className="hidden w-32 sm:block" aria-label={`Active account ${r.active_pct}% used`}>
                    <div className="h-2 overflow-hidden rounded-full bg-pitch-700">
                      <div className={cn('h-full rounded-full', r.active_pct >= 85 ? 'bg-card-yellow' : 'bg-volt-400')} style={{ width: `${Math.min(100, r.active_pct)}%` }} />
                    </div>
                    <p className="mt-1 text-right text-[11.5px] tabular text-chalk-faint">{r.active_pct}% of active</p>
                  </div>
                )}
                <StatusPill tone={r.gallery_enabled ? 'good' : 'neutral'}>{r.gallery_enabled ? 'Gallery on' : 'Off'}</StatusPill>
                <RiArrowRightSLine className="h-5 w-5 text-chalk-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function AdminStorageDetail() {
  const { id = '' } = useParams()
  const { data } = useQuery({
    queryKey: ['admin', 'storage'],
    queryFn: async () => (await api.get<Row[]>('gallery/storage')).data,
  })
  const org = data?.find((r) => r.id === id)

  return (
    <>
      <Link to="/admin/storage" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[14px] text-chalk-muted hover:text-chalk">
        <RiArrowLeftLine className="h-4 w-4" /> All groups
      </Link>
      <AdminHeader
        title={org?.name ?? 'Storage'}
        subtitle="Exactly what this group sees under Gallery → Storage."
        action={org?.gallery_enabled ? (
          <a href={`/g/${org.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-pitch-700 px-4 text-[14px] hover:border-pitch-600">
            <RiExternalLinkLine className="h-4 w-4" /> Public gallery
          </a>
        ) : undefined}
      />
      <StoragePanel orgId={id} />
    </>
  )
}
