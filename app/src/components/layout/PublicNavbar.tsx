/**
 * Floating nav for the logged-out surfaces (landing, global table, team pages).
 * A pill that hovers over the page, tightens once you scroll, and folds into a
 * sheet on phones.
 */

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { RiArrowRightLine, RiCloseLine, RiMenuLine } from '@remixicon/react'
import { cn } from '@/lib/cn'
import { usePlatformFeatures, type PlatformFeature } from '@/lib/platformFeatures'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="14.5" fill="#f4f7f5" />
      <path d="M16 9.5l5.2 3.8-2 6.1h-6.4l-2-6.1z" fill="#050706" />
      <path
        d="M16 1.5v8M21.2 13.3l7.6-2.5M19.2 19.4l4.7 6.4M12.8 19.4l-4.7 6.4M10.8 13.3L3.2 10.8"
        stroke="#050706"
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="#b4ff39" strokeWidth="1.5" />
    </svg>
  )
}

const ALL_LINKS: { to: string; label: string; match: (p: string) => boolean; feature?: PlatformFeature }[] = [
  { to: '/', label: 'Home', match: (p) => p === '/' },
  { to: '/leaderboard', label: 'Tables', match: (p) => p.startsWith('/leaderboard'), feature: 'public_tables' },
  { to: '/h2h', label: 'Head-to-head', match: (p) => p.startsWith('/h2h'), feature: 'head_to_head' },
  { to: '/contact', label: 'Contact', match: (p) => p.startsWith('/contact'), feature: 'contact_form' },
]

export function PublicNavbar() {
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const isOn = usePlatformFeatures()
  const LINKS = ALL_LINKS.filter((l) => !l.feature || isOn(l.feature))

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="sticky top-0 z-50 px-3 pt-3 safe-top">
      <nav
        aria-label="Main"
        className={cn(
          'mx-auto flex max-w-5xl items-center justify-between rounded-full border pl-4 pr-2 transition-all duration-300',
          scrolled
            ? 'h-14 border-pitch-600/70 bg-pitch-900/80 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.8)] backdrop-blur-md'
            : 'h-16 border-pitch-700/40 bg-pitch-900/60 backdrop-blur-sm',
        )}
      >
        <Link to="/" className="flex items-center gap-2.5 font-display text-[15px] font-bold tracking-tight text-chalk">
          <BrandMark className="h-7 w-7" />
          The Turf Ball
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = l.match(pathname)
            return (
              <Link
                key={l.to}
                to={l.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-full px-4 py-2 text-[14px] transition-colors duration-200',
                  active ? 'bg-pitch-700/70 text-chalk' : 'text-chalk-muted hover:text-chalk',
                )}
              >
                {l.label}
              </Link>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <Link to="/login" className="hidden rounded-full px-4 py-2 text-[14px] text-chalk-muted transition-colors hover:text-chalk sm:block">
            Log in
          </Link>
          <Link
            to="/register"
            className="group hidden items-center gap-1.5 rounded-full bg-volt-400 px-4 py-2.5 text-[14px] font-semibold text-void transition-colors hover:bg-volt-300 sm:flex"
          >
            Start free
            <RiArrowRightLine className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="flex h-11 w-11 items-center justify-center rounded-full text-chalk md:hidden"
          >
            {open ? <RiCloseLine className="h-5 w-5" /> : <RiMenuLine className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mt-2 max-w-5xl rounded-3xl border border-pitch-600/70 bg-pitch-900/95 p-2 backdrop-blur-xl md:hidden"
          >
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                aria-current={l.match(pathname) ? 'page' : undefined}
                className={cn(
                  'block rounded-2xl px-4 py-3.5 text-[16px]',
                  l.match(pathname) ? 'bg-pitch-700/60 text-chalk' : 'text-chalk-muted',
                )}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-pitch-700 pt-2">
              <Link to="/login" className="rounded-2xl border border-pitch-600 px-4 py-3 text-center text-[15px] text-chalk">
                Log in
              </Link>
              <Link to="/register" className="rounded-2xl bg-volt-400 px-4 py-3 text-center text-[15px] font-semibold text-void">
                Start free
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
