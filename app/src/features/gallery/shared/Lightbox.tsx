import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine } from '@remixicon/react'
import { AnimatePresence, motion } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { MediaBase } from '../types'
import { fullUrl, hasHd, posterUrl, videoUrl } from './media'

/**
 * Full-screen viewer. Arrow keys / swipe to move, Esc or the close button to
 * leave. Videos only load when opened and never autoplay with sound.
 * The next and previous photos are fetched ahead so paging feels instant.
 */
export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  actions,
  caption,
  onNearEnd,
}: {
  items: MediaBase[]
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
  actions?: (m: MediaBase) => ReactNode
  caption?: (m: MediaBase) => ReactNode
  onNearEnd?: () => void
}) {
  const open = index !== null && items[index] !== undefined
  const media = open ? items[index] : null
  const closeRef = useRef<HTMLButtonElement>(null)
  const dir = useRef(0)

  const go = (delta: number) => {
    if (index === null) return
    const next = index + delta
    if (next < 0 || next >= items.length) return
    dir.current = delta
    onIndex(next)
    if (next >= items.length - 3) onNearEnd?.()
  }

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prevFocus?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, items.length])

  // Warm the neighbours.
  useEffect(() => {
    if (index === null) return
    for (const n of [items[index + 1], items[index - 1]]) {
      if (n?.resource_type === 'image') new Image().src = fullUrl(n)
    }
  }, [index, items])

  return createPortal(
    <AnimatePresence>
      {open && media && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Media viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className="fixed inset-0 z-[60] flex flex-col bg-void/95 backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-3 px-3 pt-3 safe-top sm:px-5">
            <span className="tabular text-[13px] text-chalk-muted">{index! + 1} / {items.length}</span>
            <div className="flex items-center gap-1">
              {actions?.(media)}
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-chalk hover:bg-pitch-800"
              >
                <RiCloseLine className="h-6 w-6" />
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <AnimatePresence initial={false} custom={dir.current} mode="popLayout">
              <motion.div
                key={media.id}
                custom={dir.current}
                initial={{ opacity: 0, x: dir.current * 60, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: dir.current * -60, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                drag={media.resource_type === 'image' ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.4}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -80) go(1)
                  else if (info.offset.x > 80) go(-1)
                }}
                className="absolute inset-0 flex items-center justify-center p-2 sm:p-8"
              >
                {media.resource_type === 'video' ? (
                  <VideoPlayer media={media} />
                ) : (
                  <img
                    src={fullUrl(media)}
                    alt={media.title || 'Photo'}
                    draggable={false}
                    className="max-h-full max-w-full select-none rounded-lg object-contain"
                  />
                )}
              </motion.div>
            </AnimatePresence>

            <NavButton side="left" disabled={index === 0} onClick={() => go(-1)} />
            <NavButton side="right" disabled={index === items.length - 1} onClick={() => go(1)} />
          </div>

          <div className="min-h-14 px-4 pb-4 pt-2 text-center safe-bottom">{caption?.(media)}</div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function NavButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? RiArrowLeftSLine : RiArrowRightSLine
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous' : 'Next'}
      className={cn(
        'absolute top-1/2 hidden h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-pitch-700 bg-pitch-900/80 text-chalk backdrop-blur transition-opacity hover:border-volt-400/60 disabled:pointer-events-none disabled:opacity-0 sm:flex',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      <Icon className="h-7 w-7" />
    </button>
  )
}

/**
 * Plays at 720p by default to save the team's Cloudinary credits. "HD" switches
 * to full quality and carries on from the same second.
 */
function VideoPlayer({ media }: { media: MediaBase }) {
  const [hd, setHd] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)
  const resume = useRef<{ at: number; play: boolean } | null>(null)
  const canHd = hasHd(media) && Math.max(media.width ?? 0, media.height ?? 0) > 1280

  const toggle = () => {
    const el = ref.current
    if (el) resume.current = { at: el.currentTime, play: !el.paused }
    setHd((h) => !h)
  }

  return (
    <div className="relative flex max-h-full max-w-full items-center justify-center">
      <video
        ref={ref}
        key={`${media.id}-${hd}`}
        src={videoUrl(media, hd)}
        poster={posterUrl(media)}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const r = resume.current
          if (!r) return
          e.currentTarget.currentTime = r.at
          if (r.play) void e.currentTarget.play()
          resume.current = null
        }}
        className="max-h-full max-w-full rounded-xl bg-black"
      />
      {canHd && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={hd}
          aria-label={hd ? 'Switch to data saver (720p)' : 'Switch to full quality (HD)'}
          className={cn(
            'absolute right-3 top-3 flex h-11 cursor-pointer items-center rounded-full px-3 text-[12.5px] font-semibold backdrop-blur transition-colors',
            hd ? 'bg-volt-400 text-void' : 'bg-void/70 text-chalk hover:bg-void/90',
          )}
        >
          {hd ? 'HD on' : 'HD'}
        </button>
      )}
    </div>
  )
}
