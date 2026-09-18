/**
 * The file grid — used for both the live gallery and the trash.
 * Infinite scroll, multi-select, full-screen viewer, and bulk actions.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import {
  RiArrowGoBackLine,
  RiContractLeftRightLine,
  RiDeleteBin2Line,
  RiDeleteBinLine,
  RiDownload2Line,
  RiFolderTransferLine,
  RiImageLine,
  RiTimeLine,
} from '@remixicon/react'
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { relative } from '@/lib/format'
import { MasonryGrid, MediaTile } from '../shared/MediaTile'
import { Lightbox } from '../shared/Lightbox'
import { useSelection } from '../shared/useSelection'
import { formatBytes } from '../shared/media'
import type { Album, TeamMedia } from '../types'
import { useMediaActions, useMedia, type MediaFilters } from './api'
import { BarAction, SelectionBar } from './SelectionBar'
import { MoveSheet } from './MoveSheet'

export function FilesView({
  filters,
  trash,
  canManage,
  albums,
  notify,
  emptyAction,
}: {
  filters: MediaFilters
  trash?: boolean
  canManage: boolean
  albums: Album[]
  notify: (text: string, tone?: 'ok' | 'bad') => void
  emptyAction?: React.ReactNode
}) {
  const query = useMedia(trash ? { ...filters, view: 'trash' } : filters)
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const total = query.data?.pages[0]?.meta.total ?? 0
  const sel = useSelection()
  const actions = useMediaActions(notify)
  const [viewer, setViewer] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  // Filters changed: drop the old selection.
  const key = JSON.stringify(filters) + String(trash)
  useEffect(() => sel.clear(), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load more as the end comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
    }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [query])

  // Tiles rise into place as they arrive. Skipped for reduced motion.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fresh = grid.querySelectorAll('[data-tile]:not([data-shown])')
    if (!fresh.length) return
    fresh.forEach((n) => n.setAttribute('data-shown', ''))
    gsap.fromTo(fresh, { opacity: 0, y: 24, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out', stagger: 0.03, clearProps: 'transform' })
  }, [items.length])

  const selectedRows = items.filter((i) => sel.has(i.id))
  const allMine = selectedRows.every((r) => r.mine)
  const canAct = canManage || allMine
  const ids = sel.list

  const run = (fn: () => void) => {
    fn()
    sel.clear()
  }

  if (query.isLoading) {
    return (
      <MasonryGrid>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} style={{ aspectRatio: ['4/5', '1/1', '3/4', '16/9'][i % 4] }} className="mb-2 break-inside-avoid sm:mb-3">
            <Skeleton className="h-full w-full rounded-xl" />
          </div>
        ))}
      </MasonryGrid>
    )
  }
  if (query.error) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />

  if (items.length === 0) {
    return trash
      ? <EmptyState icon={<RiDeleteBinLine className="mx-auto h-10 w-10" />} title="The trash is empty" description="Anything you delete waits here for 30 days before it's gone for good." />
      : <EmptyState icon={<RiImageLine className="mx-auto h-10 w-10" />} title="Nothing here yet" description="Drop photos and videos anywhere on this page, or tap Upload." action={emptyAction} />
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-chalk-muted">
        <span className="tabular">{total.toLocaleString()} item{total === 1 ? '' : 's'}</span>
        <div className="flex gap-2">
          {trash && canManage && (
            <Button
              size="sm"
              variant="danger"
              loading={actions.emptyTrash.isPending}
              onClick={() => window.confirm('Delete everything in the trash forever? This can’t be undone.') && actions.emptyTrash.mutate({})}
            >
              <RiDeleteBin2Line className="h-4 w-4" /> Empty trash
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => (sel.mode ? sel.clear() : sel.setMode(true))}>
            {sel.mode ? 'Done' : 'Select'}
          </Button>
        </div>
      </div>

      <div ref={gridRef}>
        <MasonryGrid>
          {items.map((m, i) => (
            <MediaTile
              key={m.id}
              media={m}
              selected={sel.has(m.id)}
              selecting={sel.mode}
              onOpen={() => setViewer(i)}
              onToggle={() => sel.toggle(m.id)}
              dimmed={trash}
              badge={trash && m.purge_at ? <TrashBadge at={m.purge_at} /> : undefined}
            />
          ))}
        </MasonryGrid>
      </div>
      <div ref={sentinel} className="h-10" aria-hidden />
      {query.isFetchingNextPage && <p className="py-6 text-center text-[13px] text-chalk-muted">Loading more…</p>}

      <SelectionBar count={sel.count} onClear={sel.clear} onSelectAll={() => sel.selectAll(items.map((i) => i.id))}>
        {trash ? (
          <>
            <BarAction icon={<RiArrowGoBackLine />} label="Restore" busy={actions.restore.isPending} disabled={!canAct} onClick={() => run(() => actions.restore.mutate({ ids }))} />
            {canManage && (
              <BarAction
                icon={<RiDeleteBin2Line />}
                label="Delete forever"
                danger
                busy={actions.purge.isPending}
                onClick={() => window.confirm(`Delete ${ids.length} item${ids.length === 1 ? '' : 's'} forever? This can’t be undone.`) && run(() => actions.purge.mutate({ ids }))}
              />
            )}
          </>
        ) : (
          <>
            <BarAction icon={<RiDownload2Line />} label="Download" busy={actions.download.isPending} onClick={() => actions.download.mutate(ids)} />
            <BarAction icon={<RiFolderTransferLine />} label="Move" disabled={!canAct} onClick={() => setMoving(true)} />
            <BarAction
              icon={<RiContractLeftRightLine />}
              label="Compress"
              disabled={!canAct || ids.length > 20}
              busy={actions.compress.isPending}
              onClick={() => {
                notify('Compressing — this can take a minute for videos…')
                run(() => actions.compress.mutate({ ids }))
              }}
            />
            <BarAction icon={<RiDeleteBinLine />} label="Delete" danger disabled={!canAct} busy={actions.trash.isPending} onClick={() => run(() => actions.trash.mutate({ ids }))} />
          </>
        )}
      </SelectionBar>

      <MoveSheet
        open={moving}
        albums={albums}
        count={ids.length}
        onClose={() => setMoving(false)}
        onPick={(albumId) => {
          setMoving(false)
          run(() => actions.move.mutate({ ids, album_id: albumId }))
        }}
      />

      <Lightbox
        items={items}
        index={viewer}
        onIndex={setViewer}
        onClose={() => setViewer(null)}
        onNearEnd={() => query.hasNextPage && query.fetchNextPage()}
        actions={(m) => (
          <>
            {!trash && (
              <button type="button" onClick={() => actions.download.mutate([m.id])} aria-label="Download" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-chalk hover:bg-pitch-800">
                <RiDownload2Line className="h-5 w-5" />
              </button>
            )}
          </>
        )}
        caption={(m) => <Caption media={m as TeamMedia} />}
      />
    </>
  )
}

function TrashBadge({ at }: { at: string }) {
  const days = Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 86400_000))
  return (
    <Badge tone={days <= 3 ? 'danger' : 'neutral'} className="backdrop-blur">
      <RiTimeLine className="h-3 w-3" /> {days === 0 ? 'Today' : `${days}d left`}
    </Badge>
  )
}

function Caption({ media: m }: { media: TeamMedia }) {
  return (
    <div className="text-[13px] text-chalk-muted">
      {m.title && <p className="text-[15px] text-chalk">{m.title}</p>}
      <p>
        {m.uploader?.name ? `${m.uploader.name} · ` : ''}{relative(m.created_at)} · {formatBytes(m.bytes)}
        {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
        {m.compressed ? ' · compressed' : ''}
      </p>
    </div>
  )
}
