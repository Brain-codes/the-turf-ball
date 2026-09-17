import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { AdminHeader, Pager, StatusPill, confirmAction, useSearch, when, type PageMeta } from './shared'

type UserRow = {
  id: string
  email: string
  full_name: string | null
  is_platform_admin: boolean
  created_at: string
  deleted_at: string | null
  blocked: boolean
  last_sign_in_at: string | null
  email_confirmed: boolean
  organization_members: { role: string; status: string; organizations: { id: string; name: string; slug: string } | null }[]
}

export function AdminUsers() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { term, box } = useSearch()
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [term])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'users', term, page],
    queryFn: async () => {
      const r = await api.get<UserRow[]>('admin/users', { search: term, page, per_page: 25 })
      return { rows: r.data, meta: r.meta as unknown as PageMeta }
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { blocked?: boolean; is_platform_admin?: boolean } }) =>
      api.patch(`admin/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })

  const act = (u: UserRow, patch: { blocked?: boolean; is_platform_admin?: boolean }, message: string) => {
    if (confirmAction(message)) update.mutate({ id: u.id, patch })
  }

  return (
    <>
      <AdminHeader title="Users" subtitle="Every account, the groups it belongs to, and whether it can sign in." />
      <div className="mb-4">{box}</div>
      {update.error && <p role="alert" className="mb-4 text-[14px] text-card-red">{(update.error as Error).message}</p>}

      {isLoading && <Skeleton className="h-80" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {data && data.rows.length === 0 && <EmptyState icon="🔍" title="No accounts match" />}
      {data && data.rows.length > 0 && (
        <ul className="space-y-2.5">
          {data.rows.map((u) => {
            const self = u.id === profile?.id
            return (
              <li key={u.id} className="surface flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{u.full_name || u.email}</span>
                    {u.is_platform_admin && <StatusPill tone="accent">Super admin</StatusPill>}
                    {u.blocked && <StatusPill tone="bad">Blocked</StatusPill>}
                    {u.deleted_at && <StatusPill tone="neutral">Deleting</StatusPill>}
                    {!u.email_confirmed && <StatusPill tone="neutral">Email not verified</StatusPill>}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-chalk-muted">{u.email}</p>
                  <p className="mt-1 text-[12.5px] text-chalk-faint">
                    Joined {new Date(u.created_at).toLocaleDateString()} · last sign-in {when(u.last_sign_in_at)}
                  </p>
                  {u.organization_members.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                      {u.organization_members.map((m, i) =>
                        m.organizations ? (
                          <Link key={i} to={`/admin/groups/${m.organizations.id}`} className="text-chalk-muted underline decoration-chalk-faint/40 hover:text-chalk">
                            {m.organizations.name} <span className="text-chalk-faint">({m.role})</span>
                          </Link>
                        ) : null,
                      )}
                    </p>
                  )}
                </div>
                {!self && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={update.isPending}
                      onClick={() =>
                        act(u, { is_platform_admin: !u.is_platform_admin }, u.is_platform_admin
                          ? `Remove super admin from ${u.email}?`
                          : `Make ${u.email} a super admin? They will be able to see and change everything on the platform.`)
                      }
                      className="min-h-10 rounded-lg border border-pitch-600 px-3.5 text-[13.5px] hover:border-chalk-faint disabled:opacity-50"
                    >
                      {u.is_platform_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      type="button"
                      disabled={update.isPending}
                      onClick={() =>
                        act(u, { blocked: !u.blocked }, u.blocked
                          ? `Let ${u.email} sign in again?`
                          : `Block ${u.email}? They will be signed out and unable to sign in until you unblock them.`)
                      }
                      className={
                        u.blocked
                          ? 'min-h-10 rounded-lg bg-volt-400 px-3.5 text-[13.5px] font-semibold text-void disabled:opacity-50'
                          : 'min-h-10 rounded-lg border border-card-red/40 bg-card-red/10 px-3.5 text-[13.5px] text-card-red disabled:opacity-50'
                      }
                    >
                      {u.blocked ? 'Unblock' : 'Block'}
                    </button>
                  </div>
                )}
                {self && <p className="text-[12.5px] text-chalk-faint">This is you</p>}
              </li>
            )
          })}
        </ul>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </>
  )
}
