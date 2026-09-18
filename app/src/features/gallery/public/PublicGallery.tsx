/**
 * /g/:slug — a team's public gallery. No login needed to view, favourite or
 * download. Signed-in members of the team also see its private albums.
 *
 * Opened from WhatsApp on mobile data: the 3D hero is lazy and small, the
 * grid loads 40 at a time with shimmer placeholders, and videos only load
 * when tapped.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import gsap from 'gsap'
import {
  RiArrowDownLine,
  RiDownload2Line,
  RiHeart3Fill,
  RiHeart3Line,
  RiImageLine,
  RiLockLine,
  RiShareForwardLine,
} from '@remixicon/react'
import { api } from '@/services/client'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { CountUp } from '@/components/motion'
import { useSeo } from '@/lib/seo'
import { cn } from '@/lib/cn'
import { fullDate } from '@/lib/format'
import type { DownloadLink, MediaBase } from '../types'
import { MasonryGrid, MediaTile } from '../shared/MediaTile'
import { Lightbox } from '../shared/Lightbox'
import { useSelection } from '../shared/useSelection'
import { aspect, startDownloads, thumbUrl } from '../shared/media'
import { BarAction, SelectionBar } from '../manager/SelectionBar'
import { useFavourites, visitorId } from './favourites'
import { createHeroRing } from './heroRing'

interface PublicAlbum {
  id: string
  title: string
  description: string | null
  visibility: 'public' | 'private'
  event_date: string | null
  cover: MediaBase | null
  photos: number
  videos: number
}

interface GalleryInfo {
  organization: { name: string; short_name: string | null; slug: string; logo_url: string | null; description: string | null; location: string | null }
  member: boolean
  albums: PublicAlbum[]
  unsorted: { photos: number; videos: number }
  totals: { photos: number; videos: number }
  hero: MediaBase[]
}

type Filter = { album: string | null; type: '' | 'image' | 'video'; sort: 'recent' | 'popular' | 'oldest'; favs: boolean }

export function PublicGalleryScreen() {
  const { slug = '' } = useParams()
  const info = useQuery({
    queryKey: ['public-gallery', slug],
    // Not anonymous: a signed-in member's token unlocks private albums.
    queryFn: async () => (await api.get<GalleryInfo>(`gallery/public/${slug}`)).data,
    retry: false,
  })
  const org = info.data?.organization

  useSeo({
    title: org ? `${org.name} — Gallery` : 'Gallery',
    description: org ? `Photos and videos from ${org.name}${org.location ? `, ${org.location}` : ''}. View, favourite and download — no sign-up needed.` : undefined,
    image: info.data?.hero[0] ? thumbUrl(info.data.hero[0]) : undefined,
  })

  if (info.isLoading) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-7xl px-4 pt-28"><Skeleton className="h-[50vh] rounded-3xl" /></div>
      </PublicLayout>
    )
  }
  if (info.error || !info.data) {
    return (
      <PublicLayout>
        <div className="pt-28">
          <EmptyState icon={<RiImageLine className="mx-auto h-10 w-10" />} title="Gallery not found" description="This link may be wrong, or the gallery isn’t public yet." />
        </div>
      </PublicLayout>
    )
  }

  return <Gallery slug={slug} info={info.data} />
}

function Gallery({ slug, info }: { slug: string; info: GalleryInfo }) {
  const [filter, setFilter] = useState<Filter>({ album: null, type: '', sort: 'recent', favs: false })
  const favs = useFavourites(slug)
  const gridTop = useRef<HTMLDivElement>(null)
  const album = info.albums.find((a) => a.id === filter.album) ?? null
  const total = info.totals.photos + info.totals.videos

  const pick = (next: Partial<Filter>) => {
    setFilter((f) => ({ ...f, ...next }))
    requestAnimationFrame(() => gridTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const share = async () => {
    const url = window.location.href
    if (navigator.share) await navigator.share({ title: `${info.organization.name} — Gallery`, url }).catch(() => {})
    else await navigator.clipboard.writeText(url)
  }

  return (
    <PublicLayout className="pb-24">
      <Hero info={info} total={total} onBrowse={() => gridTop.current?.scrollIntoView({ behavior: 'smooth' })} onShare={share} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {info.albums.length > 0 && (
          <section aria-labelledby="albums-h" className="mt-4">
            <h2 id="albums-h" className="mb-4 text-2xl">Albums</h2>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
              {info.albums.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pick({ album: a.id, favs: false })}
                  className={cn(
                    'group w-56 shrink-0 cursor-pointer snap-start text-left sm:w-64',
                    filter.album === a.id && '[&_.cover]:ring-2 [&_.cover]:ring-volt-400',
                  )}
                >
                  <div className="cover relative aspect-[4/3] overflow-hidden rounded-2xl bg-pitch-800">
                    {a.cover?.urls.thumb && <img src={thumbUrl(a.cover)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />}
                    <span className="absolute inset-0 bg-gradient-to-t from-void/80 via-void/10 to-transparent" />
                    {a.visibility === 'private' && (
                      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-void/70 px-2 py-0.5 text-[11.5px] backdrop-blur"><RiLockLine className="h-3.5 w-3.5" /> Members</span>
                    )}
                    <div className="absolute inset-x-3 bottom-3">
                      <p className="truncate font-display text-[17px] font-bold">{a.title}</p>
                      <p className="text-[12.5px] text-chalk-muted">
                        {a.photos + a.videos} item{a.photos + a.videos === 1 ? '' : 's'}{a.event_date ? ` · ${fullDate(a.event_date)}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <div ref={gridTop} className="scroll-mt-20" />
        <FilterBar info={info} filter={filter} onChange={pick} favCount={favs.ids.size} />

        {album?.description && <p className="mb-4 max-w-2xl text-[15px] text-chalk-muted">{album.description}</p>}

        <PublicGrid slug={slug} filter={filter} favs={favs} />
      </div>
    </PublicLayout>
  )
}

/* ------------------------------------------------------------------ hero */

function Hero({ info, total, onBrowse, onShare }: { info: GalleryInfo; total: number; onBrowse: () => void; onShare: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const copy = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!canvas.current || !info.hero.length) return
    return createHeroRing(canvas.current, info.hero.map((m) => ({ url: thumbUrl(m), aspect: aspect(m) })))
  }, [info.hero])

  useLayoutEffect(() => {
    if (!copy.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('[data-hero-line]', { y: 40, opacity: 0, duration: 0.9, ease: 'power4.out', stagger: 0.08, delay: 0.3 })
    }, copy)
    return () => ctx.revert()
  }, [])

  const o = info.organization
  return (
    <section className="relative isolate flex min-h-[78svh] items-end overflow-hidden pb-10 pt-28 sm:min-h-[86svh]">
      {info.hero.length > 0 && <canvas ref={canvas} aria-hidden className="absolute inset-0 -z-10 h-full w-full" />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_35%,transparent_20%,var(--color-void)_78%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-[60%] bg-gradient-to-t from-void via-void/75 to-transparent lg:h-48 lg:via-transparent" />
      {/* Keeps the copy readable over the photos. */}
      <div aria-hidden className="absolute inset-y-0 left-0 -z-10 hidden w-3/5 bg-gradient-to-r from-void via-void/80 to-transparent lg:block" />

      <div ref={copy} className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div data-hero-line className="mb-4 flex items-center gap-3">
          {o.logo_url && <img src={o.logo_url} alt="" className="h-12 w-12 rounded-xl object-cover ring-1 ring-pitch-600" />}
          <span className="rounded-full border border-volt-400/40 bg-volt-400/10 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-volt-400">Gallery</span>
        </div>
        <h1 data-hero-line className="max-w-4xl text-[clamp(2.6rem,9vw,6.5rem)] leading-[0.92]">{o.name}</h1>
        <p data-hero-line className="mt-4 max-w-xl text-[16px] leading-relaxed text-chalk-muted">
          {o.description || `Every goal, every celebration, every Sunday.`} Tap any photo to view it full screen, heart your favourites and download what you like. No sign-up needed.
        </p>
        <div data-hero-line className="mt-6 flex flex-wrap items-center gap-6">
          <Stat value={info.totals.photos} label="photos" />
          <Stat value={info.totals.videos} label="videos" />
          <Stat value={info.albums.length} label="albums" />
        </div>
        <div data-hero-line className="mt-7 flex flex-wrap gap-3">
          <Button size="lg" onClick={onBrowse} disabled={!total}>
            <RiArrowDownLine className="h-5 w-5" /> Browse the gallery
          </Button>
          <Button size="lg" variant="secondary" onClick={onShare}>
            <RiShareForwardLine className="h-5 w-5" /> Share
          </Button>
        </div>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-numeric text-[40px] leading-none tabular text-chalk"><CountUp value={value} /></p>
      <p className="text-[12px] uppercase tracking-wider text-chalk-faint">{label}</p>
    </div>
  )
}

/* ------------------------------------------------------------ filter bar */

function FilterBar({ info, filter, onChange, favCount }: { info: GalleryInfo; filter: Filter; onChange: (f: Partial<Filter>) => void; favCount: number }) {
  const chip = (active: boolean) =>
    cn('h-10 shrink-0 cursor-pointer rounded-full px-4 text-[14px] transition-colors', active ? 'bg-chalk font-semibold text-void' : 'bg-pitch-800 text-chalk-muted hover:text-chalk')

  return (
    <div className="sticky top-16 z-20 -mx-4 mb-5 mt-8 border-b border-pitch-800 bg-void/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" className={chip(!filter.album && !filter.favs)} onClick={() => onChange({ album: null, favs: false })}>All</button>
        <button type="button" className={cn(chip(filter.favs), 'flex items-center gap-1.5')} onClick={() => onChange({ favs: !filter.favs, album: null })}>
          <RiHeart3Fill className={cn('h-4 w-4', filter.favs ? 'text-card-red' : '')} /> My favourites{favCount ? ` (${favCount})` : ''}
        </button>
        {info.albums.map((a) => (
          <button key={a.id} type="button" className={chip(filter.album === a.id)} onClick={() => onChange({ album: a.id, favs: false })}>{a.title}</button>
        ))}
        {info.unsorted.photos + info.unsorted.videos > 0 && info.albums.length > 0 && (
          <button type="button" className={chip(filter.album === 'none')} onClick={() => onChange({ album: 'none', favs: false })}>More</button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {(['', 'image', 'video'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={filter.type === t} onClick={() => onChange({ type: t })} className={cn('h-9 cursor-pointer rounded-lg px-3 text-[13px]', filter.type === t ? 'bg-pitch-700 font-semibold text-chalk' : 'text-chalk-muted hover:text-chalk')}>
            {t === '' ? 'Everything' : t === 'image' ? 'Photos' : 'Videos'}
          </button>
        ))}
        <select
          aria-label="Sort"
          value={filter.sort}
          onChange={(e) => onChange({ sort: e.target.value as Filter['sort'] })}
          className="ml-auto h-9 cursor-pointer rounded-lg border border-pitch-700 bg-pitch-900 px-2 text-[13px] text-chalk focus:border-volt-400 focus:outline-none"
        >
          <option value="recent">Newest</option>
          <option value="popular">Most loved</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ grid */

function PublicGrid({ slug, filter, favs }: { slug: string; filter: Filter; favs: ReturnType<typeof useFavourites> }) {
  const qc = useQueryClient()
  const sel = useSelection()
  const [viewer, setViewer] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const favIds = filter.favs ? [...favs.ids].join(',') : ''

  const query = useInfiniteQuery({
    queryKey: ['public-gallery', slug, 'media', filter, favIds],
    initialPageParam: 1,
    enabled: !filter.favs || favs.ids.size > 0,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<MediaBase[]>(`gallery/public/${slug}/media`, {
        page: pageParam,
        per_page: 40,
        album: filter.album ?? undefined,
        type: filter.type || undefined,
        sort: filter.sort,
        only: favIds || undefined,
      })
      return { items: r.data, meta: r.meta as { page: number; total_pages: number } }
    },
    getNextPageParam: (l) => (l.meta.page < l.meta.total_pages ? l.meta.page + 1 : undefined),
  })
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  useEffect(() => sel.clear(), [JSON.stringify(filter)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
    }, { rootMargin: '900px' })
    io.observe(el)
    return () => io.disconnect()
  }, [query])

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fresh = grid.querySelectorAll('[data-tile]:not([data-shown])')
    if (!fresh.length) return
    fresh.forEach((n) => n.setAttribute('data-shown', ''))
    gsap.fromTo(fresh, { opacity: 0, y: 32 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.035, clearProps: 'transform' })
  }, [items.length])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 3500)
    return () => clearTimeout(t)
  }, [note])

  const heart = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.post<{ favourite_count: number }>(`gallery/public/${slug}/favourite`, { media_id: id, visitor_id: visitorId(), on }),
    onMutate: ({ id, on }) => favs.set(id, on),
    onSuccess: (r, { id }) => {
      qc.setQueriesData<{ pages: { items: MediaBase[] }[] }>({ queryKey: ['public-gallery', slug, 'media'] }, (d) =>
        d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === id ? { ...m, favourite_count: r.data.favourite_count } : m)) })) },
      )
    },
    onError: (_e, { id, on }) => favs.set(id, !on),
  })

  const download = useMutation({
    mutationFn: (ids: string[]) => api.post<{ links: DownloadLink[] }>(`gallery/public/${slug}/download`, { ids }),
    onSuccess: (r) => {
      startDownloads(r.data.links)
      setNote(r.data.links.length > 1 ? `Downloading in ${r.data.links.length} parts` : 'Download started')
    },
    onError: (e: Error) => setNote(e.message),
  })

  if (filter.favs && favs.ids.size === 0) {
    return <EmptyState icon={<RiHeart3Line className="mx-auto h-10 w-10" />} title="No favourites yet" description="Tap the heart on any photo or video to keep it here. Saved on this device." />
  }
  if (query.isLoading) {
    return (
      <MasonryGrid>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} style={{ aspectRatio: ['4/5', '1/1', '3/4', '16/9'][i % 4] }} className="mb-2 break-inside-avoid sm:mb-3"><Skeleton className="h-full w-full rounded-xl" /></div>
        ))}
      </MasonryGrid>
    )
  }
  if (query.error) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
  if (!items.length) return <EmptyState icon={<RiImageLine className="mx-auto h-10 w-10" />} title="Nothing here yet" description="Check back after the next match day." />

  return (
    <>
      <div ref={gridRef}>
        <MasonryGrid>
          {items.map((m, i) => (
            <MediaTile
              key={m.id}
              media={m}
              selected={sel.has(m.id)}
              selecting={sel.mode}
              favourited={favs.has(m.id)}
              onOpen={() => setViewer(i)}
              onToggle={() => sel.toggle(m.id)}
            />
          ))}
        </MasonryGrid>
      </div>
      <div ref={sentinel} className="h-10" aria-hidden />
      {query.isFetchingNextPage && <p className="py-6 text-center text-[13px] text-chalk-muted">Loading more…</p>}

      <SelectionBar count={sel.count} onClear={sel.clear} onSelectAll={() => sel.selectAll(items.map((m) => m.id))}>
        <BarAction icon={<RiDownload2Line />} label="Download" busy={download.isPending} onClick={() => download.mutate(sel.list)} />
        <BarAction
          icon={<RiHeart3Line />}
          label="Favourite"
          onClick={() => {
            sel.list.filter((id) => !favs.has(id)).forEach((id) => heart.mutate({ id, on: true }))
            sel.clear()
            setNote('Added to your favourites')
          }}
        />
      </SelectionBar>

      <Lightbox
        items={items}
        index={viewer}
        onIndex={setViewer}
        onClose={() => setViewer(null)}
        onNearEnd={() => query.hasNextPage && query.fetchNextPage()}
        actions={(m) => {
          const on = favs.has(m.id)
          return (
            <>
              <button
                type="button"
                onClick={() => heart.mutate({ id: m.id, on: !on })}
                aria-label={on ? 'Remove from favourites' : 'Add to favourites'}
                aria-pressed={on}
                className="flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-chalk hover:bg-pitch-800"
              >
                {on ? <RiHeart3Fill className="h-5 w-5 text-card-red" /> : <RiHeart3Line className="h-5 w-5" />}
                <span className="tabular text-[13px]">{m.favourite_count}</span>
              </button>
              <button type="button" onClick={() => download.mutate([m.id])} aria-label="Download" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-chalk hover:bg-pitch-800">
                <RiDownload2Line className="h-5 w-5" />
              </button>
            </>
          )
        }}
        caption={(m) => (
          <div className="text-[13px] text-chalk-muted">
            {m.title && <p className="text-[15px] text-chalk">{m.title}</p>}
            <p>{fullDate(m.created_at)}</p>
          </div>
        )}
      />

      {note && (
        <p role="status" className="fixed left-1/2 top-20 z-[80] -translate-x-1/2 rounded-full bg-chalk px-5 py-2.5 text-[14px] font-medium text-void shadow-xl">
          {note}
        </p>
      )}
    </>
  )
}
