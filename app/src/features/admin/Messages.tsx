import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/client'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AdminHeader, Pager, StatusPill, when, type PageMeta } from './shared'

type Message = {
  id: string
  name: string
  email: string
  topic: string
  message: string
  status: 'new' | 'read' | 'replied' | 'spam'
  created_at: string
}

const FILTERS = [
  ['', 'Inbox'],
  ['new', 'New'],
  ['replied', 'Replied'],
  ['spam', 'Spam'],
] as const

const TOPIC: Record<string, string> = {
  question: 'Question',
  suggestion: 'Suggestion',
  bug: 'Bug report',
  partnership: 'Partnership',
  other: 'Other',
}

export function AdminMessages() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>('')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [status])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'messages', status, page],
    queryFn: async () => {
      const r = await api.get<Message[]>('admin/messages', { status, page, per_page: 20 })
      return { rows: r.data, meta: r.meta as unknown as PageMeta }
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, status: next }: { id: string; status: Message['status'] }) =>
      api.patch(`admin/messages/${id}`, { status: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })

  return (
    <>
      <AdminHeader title="Messages" subtitle="What people sent through the Contact page. Spam is hidden from the inbox." />
      <div role="radiogroup" aria-label="Filter" className="mb-4 flex w-fit gap-1 rounded-lg bg-pitch-900 p-1">
        {FILTERS.map(([v, l]) => (
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

      {isLoading && <Skeleton className="h-80" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {data && data.rows.length === 0 && <EmptyState icon="📭" title="Nothing here" description="New messages from the Contact page show up here." />}
      {data && data.rows.length > 0 && (
        <ul className="space-y-3">
          {data.rows.map((m) => (
            <li key={m.id} className={cn('surface p-5', m.status === 'new' && 'border-volt-400/40')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="text-[13px] text-chalk-muted">{m.email}</span>
                <StatusPill tone="neutral">{TOPIC[m.topic] ?? m.topic}</StatusPill>
                {m.status === 'new' && <StatusPill tone="accent">New</StatusPill>}
                {m.status === 'replied' && <StatusPill tone="good">Replied</StatusPill>}
                {m.status === 'spam' && <StatusPill tone="bad">Spam</StatusPill>}
                <span className="ml-auto text-[12.5px] text-chalk-faint">{when(m.created_at)}</span>
              </div>
              {/* Rendered as plain text: React escapes it, and whitespace is kept. */}
              <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.message}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={`mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: your message to The Turf Ball')}`}
                  onClick={() => m.status !== 'replied' && update.mutate({ id: m.id, status: 'replied' })}
                  className="inline-flex min-h-10 items-center rounded-lg bg-volt-400 px-3.5 text-[13.5px] font-semibold text-void"
                >
                  Reply by email
                </a>
                {m.status === 'new' && (
                  <button type="button" onClick={() => update.mutate({ id: m.id, status: 'read' })} className="min-h-10 rounded-lg border border-pitch-600 px-3.5 text-[13.5px]">
                    Mark as read
                  </button>
                )}
                {m.status !== 'spam' ? (
                  <button type="button" onClick={() => update.mutate({ id: m.id, status: 'spam' })} className="min-h-10 rounded-lg px-3.5 text-[13.5px] text-chalk-muted hover:text-card-red">
                    Mark as spam
                  </button>
                ) : (
                  <button type="button" onClick={() => update.mutate({ id: m.id, status: 'read' })} className="min-h-10 rounded-lg border border-pitch-600 px-3.5 text-[13.5px]">
                    Not spam
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </>
  )
}
