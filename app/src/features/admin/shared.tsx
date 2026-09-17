import { useState, type ReactNode } from 'react'
import { RiArrowLeftSLine, RiArrowRightSLine, RiSearchLine } from '@remixicon/react'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { cn } from '@/lib/cn'

export type PageMeta = { page: number; per_page: number; total: number; total_pages: number }

export function AdminHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-chalk-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function useSearch() {
  const [value, setValue] = useState('')
  const debounced = useDebouncedValue(value, 300)
  const box = (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">Search</span>
      <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chalk-faint" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search…"
        className="h-11 w-full rounded-lg border border-pitch-700 bg-pitch-900 pl-9 pr-3 text-[15px] text-chalk placeholder:text-chalk-faint focus:border-volt-400 focus:outline-none"
      />
    </label>
  )
  return { term: debounced, box }
}

export function Pager({ meta, onPage }: { meta?: PageMeta; onPage: (p: number) => void }) {
  if (!meta || meta.total_pages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-[13px] text-chalk-muted">
      <span className="tabular">{meta.total.toLocaleString()} total · page {meta.page} of {meta.total_pages}</span>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-pitch-700 disabled:opacity-40"
        >
          <RiArrowLeftSLine className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={meta.page >= meta.total_pages}
          onClick={() => onPage(meta.page + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-pitch-700 disabled:opacity-40"
        >
          <RiArrowRightSLine className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export function StatusPill({ tone, children }: { tone: 'good' | 'bad' | 'neutral' | 'accent'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        tone === 'good' && 'bg-turf-500/15 text-turf-400',
        tone === 'bad' && 'bg-card-red/15 text-card-red',
        tone === 'neutral' && 'bg-pitch-700/70 text-chalk-muted',
        tone === 'accent' && 'bg-volt-400/15 text-volt-400',
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

export function when(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Confirm a consequential change. Returns a promise-free boolean for simplicity. */
export function confirmAction(message: string) {
  return window.confirm(message)
}
