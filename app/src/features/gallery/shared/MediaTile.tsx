import { memo, useState, type ReactNode } from 'react'
import { RiCheckLine, RiHeart3Fill, RiPlayFill } from '@remixicon/react'
import { cn } from '@/lib/cn'
import type { MediaBase } from '../types'
import { aspect, formatDuration, thumbUrl } from './media'

/**
 * One item in a masonry grid. Space is reserved from the stored width/height
 * so nothing jumps as images arrive, and a shimmer fills it first.
 *
 * Tap opens it; in select mode tap toggles instead. The corner check is
 * always a separate 44px target so selecting never needs a long-press.
 */
export const MediaTile = memo(function MediaTile({
  media,
  selected,
  selecting,
  onOpen,
  onToggle,
  favourited,
  badge,
  dimmed,
}: {
  media: MediaBase
  selected: boolean
  selecting: boolean
  onOpen: () => void
  onToggle: () => void
  favourited?: boolean
  badge?: ReactNode
  dimmed?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const label = media.title || (media.resource_type === 'video' ? 'Video' : 'Photo')

  return (
    <div data-tile className="group relative mb-2 break-inside-avoid sm:mb-3">
      <button
        type="button"
        onClick={selecting ? onToggle : onOpen}
        aria-label={selecting ? `${selected ? 'Deselect' : 'Select'} ${label}` : `Open ${label}`}
        className={cn(
          'relative block w-full cursor-pointer overflow-hidden rounded-xl bg-pitch-800 transition-[transform,box-shadow] duration-200 ease-[var(--ease-out-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt-400',
          selected ? 'scale-[0.94] ring-2 ring-volt-400' : 'hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-12px_rgba(180,255,57,0.25)]',
          dimmed && 'opacity-60',
        )}
        style={{ aspectRatio: String(aspect(media)) }}
      >
        {/* No blurred preview image: on the free plan it would be one more
            paid transformation per file. A shimmer fills the space instead. */}
        {!loaded && <span aria-hidden className="absolute inset-0 animate-pulse bg-pitch-700/60" />}
        <img
          src={thumbUrl(media)}
          alt={label}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
        />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-void/70 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        {media.resource_type === 'video' && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-void/70 px-2 py-0.5 text-[11.5px] font-medium tabular text-chalk backdrop-blur">
            <RiPlayFill className="h-3.5 w-3.5 text-volt-400" /> {formatDuration(media.duration)}
          </span>
        )}
        {media.favourite_count > 0 && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-void/70 px-2 py-0.5 text-[11.5px] tabular text-chalk backdrop-blur">
            <RiHeart3Fill className={cn('h-3.5 w-3.5', favourited ? 'text-card-red' : 'text-chalk-muted')} />
            {media.favourite_count}
          </span>
        )}
        {badge && <span className="absolute left-2 top-2">{badge}</span>}
      </button>

      <button
        type="button"
        onClick={onToggle}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${label}`}
        aria-pressed={selected}
        className={cn(
          'absolute right-0 top-0 flex h-11 w-11 items-center justify-center transition-opacity duration-150',
          selecting || selected ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors',
            selected ? 'border-volt-400 bg-volt-400 text-void' : 'border-chalk/80 bg-void/40 backdrop-blur',
          )}
        >
          {selected && <RiCheckLine className="h-4 w-4" />}
        </span>
      </button>
    </div>
  )
})

export function MasonryGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4 2xl:columns-5', className)}>{children}</div>
}
