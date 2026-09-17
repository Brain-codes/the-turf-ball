import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiArrowLeftLine, RiExternalLinkLine } from '@remixicon/react'
import { api } from '@/services/client'
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AdminHeader, Pager, StatusPill, confirmAction, useSearch, when, type PageMeta } from './shared'

type GroupRow = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  location: string | null
  venue: string | null
  status: 'active' | 'archived'
  created_at: string
  owner: { id: string; email: string; full_name: string | null } | null
  members: number
  players: number
  sessions: number
}

function Logo({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img src={url} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
  ) : (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pitch-800 font-display text-[13px] font-bold text-chalk-muted">
      {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
    </span>
  )
}

function useSetStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'archived' }) =>
      api.patch(`admin/organizations/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}

export function AdminGroups() {
  const { term, box } = useSearch()
  const [status, setStatus] = useState<'' | 'active' | 'archived'>('')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [term, status])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'groups', term, status, page],
    queryFn: async () => {
      const r = await api.get<GroupRow[]>('admin/organizations', { search: term, status, page, per_page: 25 })
      return { rows: r.data, meta: r.meta as unknown as PageMeta }
    },
  })

  return (
    <>
      <AdminHeader title="Groups" subtitle="Every football group on the platform." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {box}
        <div role="radiogroup" aria-label="Status" className="flex gap-1 rounded-lg bg-pitch-900 p-1">
          {([['', 'All'], ['active', 'Active'], ['archived', 'Suspended']] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={status === v}
              onClick={() => setStatus(v)}
              className={cn('min-h-9 rounded-md px-3 text-[13px]', status === v ? 'bg-pitch-700 text-chalk' : 'text-chalk-muted')}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <Skeleton className="h-80" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {data && data.rows.length === 0 && <EmptyState icon="🔍" title="No groups match" />}
      {data && data.rows.length > 0 && (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead className="border-b border-pitch-700 text-[12px] uppercase tracking-wider text-chalk-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Group</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 text-right font-medium">Members</th>
                <th className="px-4 py-3 text-right font-medium">Players</th>
                <th className="px-4 py-3 text-right font-medium">Sessions</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((g) => (
                <tr key={g.id} className="border-b border-pitch-800 last:border-0 hover:bg-pitch-800/40">
                  <td className="px-4 py-3">
                    <Link to={`/admin/groups/${g.id}`} className="flex items-center gap-3">
                      <Logo url={g.logo_url} name={g.name} />
                      <span>
                        <span className="block font-medium text-chalk">{g.name}</span>
                        <span className="text-[12px] text-chalk-faint">{[g.venue, g.location].filter(Boolean).join(' · ') || g.slug}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-chalk-muted">{g.owner?.email ?? '—'}</td>
                  <td className="tabular px-4 py-3 text-right">{g.members}</td>
                  <td className="tabular px-4 py-3 text-right">{g.players}</td>
                  <td className="tabular px-4 py-3 text-right">{g.sessions}</td>
                  <td className="px-4 py-3">
                    {g.status === 'active' ? <StatusPill tone="good">Active</StatusPill> : <StatusPill tone="bad">Suspended</StatusPill>}
                  </td>
                  <td className="px-4 py-3 text-chalk-muted">{new Date(g.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </>
  )
}

type GroupDetail = {
  organization: GroupRow & { description: string | null; format: string; timezone: string }
  members: { role: string; status: string; created_at: string; profiles: { id: string; email: string; full_name: string | null } | null }[]
  recent_sessions: { id: string; title: string | null; session_date: string; status: string }[]
  public_page: { slug: string; is_published: boolean; view_count: number } | null
  stats: { appearances: number; goals: number; assists: number; clean_sheets: number } | null
}

export function AdminGroupDetail() {
  const { id } = useParams<{ id: string }>()
  const setStatus = useSetStatus()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'group', id],
    queryFn: async () => (await api.get<GroupDetail>(`admin/organizations/${id}`)).data,
  })

  if (isLoading) return <Skeleton className="h-96" />
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
  if (!data) return null
  const org = data.organization
  const suspended = org.status === 'archived'

  const toggle = () => {
    const next = suspended ? 'active' : 'archived'
    const msg = suspended
      ? `Restore ${org.name}? Its members get access back and its public page returns.`
      : `Suspend ${org.name}? Its members lose access and its public page disappears until you restore it.`
    if (confirmAction(msg)) setStatus.mutate({ id: org.id, status: next }, { onSuccess: () => refetch() })
  }

  return (
    <>
      <Link to="/admin/groups" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[14px] text-chalk-muted hover:text-chalk">
        <RiArrowLeftLine className="h-4 w-4" /> All groups
      </Link>
      <AdminHeader
        title={org.name}
        subtitle={`Owner: ${org.owner?.email ?? 'unknown'} · created ${when(org.created_at)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {data.public_page && !suspended && (
              <a href={`/t/${data.public_page.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-pitch-600 px-4 text-[14px]">
                Public page <RiExternalLinkLine className="h-4 w-4" />
              </a>
            )}
            <Button variant={suspended ? 'primary' : 'danger'} loading={setStatus.isPending} onClick={toggle}>
              {suspended ? 'Restore group' : 'Suspend group'}
            </Button>
          </div>
        }
      />
      {setStatus.error && <p role="alert" className="mb-4 text-[14px] text-card-red">{(setStatus.error as Error).message}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-5">
          <h2 className="text-[15px]">At a glance</h2>
          <dl className="mt-3 space-y-2 text-[14px]">
            {[
              ['Status', suspended ? 'Suspended' : 'Active'],
              ['Format', org.format],
              ['Where', [org.venue, org.location].filter(Boolean).join(', ') || '—'],
              ['Public page', data.public_page ? (data.public_page.is_published ? `Published · ${data.public_page.view_count} views` : 'Not published') : '—'],
              ['Goals', data.stats?.goals ?? 0],
              ['Assists', data.stats?.assists ?? 0],
              ['Appearances', data.stats?.appearances ?? 0],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-4"><dt className="text-chalk-muted">{k}</dt><dd className="text-right">{v}</dd></div>
            ))}
          </dl>
        </div>
        <div className="surface p-5">
          <h2 className="text-[15px]">Members</h2>
          <ul className="mt-3 space-y-2 text-[14px]">
            {data.members.map((m, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">{m.profiles?.email ?? '—'}</span>
                <span className="shrink-0 capitalize text-chalk-muted">{m.role}{m.status !== 'active' ? ` (${m.status})` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="surface p-5">
          <h2 className="text-[15px]">Recent sessions</h2>
          {data.recent_sessions.length === 0 ? (
            <p className="mt-3 text-[14px] text-chalk-muted">No sessions yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-[14px]">
              {data.recent_sessions.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="truncate">{s.title || s.session_date}</span>
                  <span className="shrink-0 capitalize text-chalk-muted">{s.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
