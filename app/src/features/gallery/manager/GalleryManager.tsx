/**
 * /app/gallery — the team's side of the gallery. Drive-like: drop files
 * anywhere, sort them into albums, select many, move, compress, delete (to a
 * 30-day trash), and see the group's storage.
 *
 * Tab, album and filters live in the URL, so every view can be linked to
 * and survives a refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  RiArrowLeftLine,
  RiFileCopyLine,
  RiExternalLinkLine,
  RiLockLine,
  RiSearchLine,
  RiUploadCloud2Line,
} from '@remixicon/react'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import { Button, EmptyState, Select } from '@/components/ui'
import { AnimatePresence, motion } from '@/components/motion'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useSeo } from '@/lib/seo'
import { cn } from '@/lib/cn'
import type { Album } from '../types'
import { StoragePanel } from '../storage/StoragePanel'
import { useAlbums, type MediaFilters } from './api'
import { useUploads } from './uploads'
import { UploadQueue } from './UploadQueue'
import { FilesView } from './FilesView'
import { AlbumsView } from './AlbumsView'
import { AlbumSheet } from './AlbumSheet'

type Tab = 'files' | 'albums' | 'trash' | 'storage'
const TABS: { id: Tab; label: string }[] = [
  { id: 'files', label: 'All files' },
  { id: 'albums', label: 'Albums' },
  { id: 'trash', label: 'Trash' },
  { id: 'storage', label: 'Storage' },
]

export function GalleryManager() {
  useSeo({ title: 'Gallery', noindex: true })
  const { activeOrg, profile } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'files'
  const albumId = params.get('album')
  const [type, setType] = useState<MediaFilters['type']>('')
  const [sort, setSort] = useState<NonNullable<MediaFilters['sort']>>('recent')
  const [mine, setMine] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search, 300)
  const [albumSheet, setAlbumSheet] = useState<{ album: Album | null } | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { add, setOnDone } = useUploads()
  const albums = useAlbums()

  const role = activeOrg?.role
  const canManage = role === 'owner' || role === 'admin'
  const shareUrl = activeOrg ? `${window.location.origin}/g/${activeOrg.slug}` : ''
  const currentAlbum = albums.data?.albums.find((a) => a.id === albumId) ?? null

  const notify = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => setToast({ text, tone }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Refresh the grid as each upload lands.
  useEffect(() => setOnDone(() => qc.invalidateQueries({ queryKey: ['gallery'] })), [qc, setOnDone])

  const go = (next: Partial<{ tab: Tab; album: string | null }>) => {
    const p = new URLSearchParams(params)
    if (next.tab) p.set('tab', next.tab)
    if (next.album !== undefined) {
      if (next.album) p.set('album', next.album)
      else p.delete('album')
    }
    setParams(p)
  }

  const upload = (files: FileList | File[] | null) => {
    if (!files?.length) return
    const rejected = add([...files], albumId && albumId !== 'none' ? albumId : null)
    if (rejected.length === 1) notify(`Skipped ${rejected[0].name}: ${rejected[0].reason}`, 'bad')
    else if (rejected.length) notify(`${rejected.length} files skipped — photos must be under 10 MB, videos under 100 MB`, 'bad')
    if (tab !== 'files') go({ tab: 'files' })
  }

  // Drop files anywhere on the page.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      upload(e.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  })

  if (!activeOrg) return null
  if (!activeOrg.gallery_enabled) {
    return (
      <>
        <PageHeader title="Gallery" />
        <EmptyState icon={<RiLockLine className="mx-auto h-10 w-10" />} title="The gallery isn’t on for this group yet" description="Ask The Turf Ball team to switch it on. Then add a Cloudinary account under Storage and start uploading." />
      </>
    )
  }

  const filters: MediaFilters = { album: albumId, type, sort, mine, q }
  const uploadButton = (
    <Button onClick={() => fileInput.current?.click()}>
      <RiUploadCloud2Line className="h-5 w-5" /> Upload
    </Button>
  )

  return (
    <div className="pb-10">
      <PageHeader
        title="Gallery"
        subtitle={`${activeOrg.name}’s photos and videos`}
        action={<div className="hidden sm:block">{uploadButton}</div>}
      />
      <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = '' }} />

      <div className="px-5">
        {/* Share link */}
        <div className="surface mb-5 flex flex-wrap items-center gap-2 px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-[13.5px] text-chalk-muted">
            Public gallery: <span className="text-chalk">{shareUrl.replace(/^https?:\/\//, '')}</span>
          </p>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(shareUrl).then(() => notify('Link copied'))}>
            <RiFileCopyLine className="h-4 w-4" /> Copy link
          </Button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-chalk-muted hover:bg-pitch-800 hover:text-chalk">
            <RiExternalLinkLine className="h-4 w-4" /> Open
          </a>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="Gallery sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-pitch-700">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => go({ tab: t.id, album: t.id === 'files' ? albumId : null })}
              className={cn(
                'relative h-11 shrink-0 cursor-pointer px-4 text-[14.5px] transition-colors',
                tab === t.id ? 'font-semibold text-chalk' : 'text-chalk-muted hover:text-chalk',
              )}
            >
              {t.label}
              {tab === t.id && <motion.span layoutId="gallery-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-volt-400" />}
            </button>
          ))}
        </div>

        {tab === 'files' && (
          <>
            {currentAlbum || albumId === 'none' ? (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => go({ album: null })} className="flex h-11 cursor-pointer items-center gap-1.5 rounded-lg pr-2 text-[14px] text-chalk-muted hover:text-chalk">
                  <RiArrowLeftLine className="h-4 w-4" /> All files
                </button>
                <h2 className="text-xl">{currentAlbum?.title ?? 'Unsorted'}</h2>
                {currentAlbum?.visibility === 'private' && <span className="flex items-center gap-1 text-[13px] text-chalk-muted"><RiLockLine className="h-4 w-4" /> Members only</span>}
                {currentAlbum && (currentAlbum.created_by === profile?.id || canManage) && (
                  <Button size="sm" variant="ghost" onClick={() => setAlbumSheet({ album: currentAlbum })}>Edit album</Button>
                )}
              </div>
            ) : null}

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 sm:max-w-xs">
                <span className="sr-only">Search by name</span>
                <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chalk-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name"
                  className="h-11 w-full rounded-lg border border-pitch-700 bg-pitch-900 pl-9 pr-3 text-[15px] text-chalk placeholder:text-chalk-faint focus:border-volt-400 focus:outline-none"
                />
              </label>
              <Segmented value={type ?? ''} onChange={(v) => setType(v as MediaFilters['type'])} options={[['', 'All'], ['image', 'Photos'], ['video', 'Videos']]} />
              <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
                <option value="recent">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="popular">Most loved</option>
                <option value="largest">Largest</option>
              </Select>
              <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-[14px] text-chalk-muted">
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-5 w-5 accent-[var(--color-volt-400)]" />
                Mine only
              </label>
            </div>

            <FilesView filters={filters} canManage={canManage} albums={albums.data?.albums ?? []} notify={notify} emptyAction={uploadButton} />
          </>
        )}

        {tab === 'albums' && albums.data && (
          <AlbumsView
            albums={albums.data.albums}
            unsorted={albums.data.unsorted}
            canEdit={(a) => canManage || a.created_by === profile?.id}
            onOpen={(id) => go({ tab: 'files', album: id })}
            onCreate={() => setAlbumSheet({ album: null })}
            onEdit={(a) => setAlbumSheet({ album: a })}
            notify={notify}
          />
        )}

        {tab === 'trash' && (
          <>
            <p className="mb-4 text-[13.5px] text-chalk-muted">
              Deleted files stay here for 30 days, then they’re removed from storage for good.{!canManage && ' You can see and restore the ones you uploaded.'}
            </p>
            <FilesView filters={{}} trash canManage={canManage} albums={[]} notify={notify} />
          </>
        )}

        {tab === 'storage' && <StoragePanel orgId={activeOrg.id} />}
      </div>

      {/* Mobile upload button */}
      {tab !== 'storage' && (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          aria-label="Upload photos or videos"
          className="fixed bottom-24 right-4 z-30 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-volt-400 text-void shadow-[0_8px_30px_-6px_rgba(180,255,57,0.6)] active:scale-95 sm:hidden"
        >
          <RiUploadCloud2Line className="h-6 w-6" />
        </button>
      )}

      <UploadQueue />

      <AlbumSheet
        open={!!albumSheet}
        album={albumSheet?.album ?? null}
        onClose={() => setAlbumSheet(null)}
        onSaved={(a, msg) => {
          setAlbumSheet(null)
          notify(msg)
          if (!albumSheet?.album) go({ tab: 'files', album: a.id })
        }}
      />

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-void/80 backdrop-blur-sm"
          >
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-volt-400 px-16 py-12 text-center">
              <RiUploadCloud2Line className="h-12 w-12 text-volt-400" />
              <p className="font-display text-2xl font-bold">Drop to upload</p>
              <p className="text-[14px] text-chalk-muted">{currentAlbum ? `Into “${currentAlbum.title}”` : 'Into Unsorted'}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.p
            role={toast.tone === 'bad' ? 'alert' : 'status'}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className={cn(
              'fixed left-1/2 top-4 z-[80] max-w-[92vw] -translate-x-1/2 rounded-full px-5 py-2.5 text-[14px] font-medium shadow-xl',
              toast.tone === 'bad' ? 'bg-card-red text-white' : 'bg-chalk text-void',
            )}
          >
            {toast.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div role="radiogroup" className="flex h-11 rounded-lg border border-pitch-700 bg-pitch-900 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('cursor-pointer rounded-md px-3 text-[13.5px] transition-colors', value === v ? 'bg-pitch-700 font-semibold text-chalk' : 'text-chalk-muted hover:text-chalk')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
