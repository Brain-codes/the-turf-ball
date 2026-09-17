/**
 * Shell for the public pages that aren't the landing page: tables, head-to-
 * head, team, player, live and contact. Same world as the landing page, turned
 * down — a slow CSS pitch backdrop instead of WebGL (these pages are opened on
 * mobile data from WhatsApp), and cards that ease in as they scroll into view.
 */

import { useEffect, useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { gsap } from 'gsap'
import { PublicNavbar } from './PublicNavbar'
import { SiteFooter } from './SiteFooter'
import { cn } from '@/lib/cn'

const REVEAL = '[data-reveal], .surface, .surface-raised'

/**
 * Eases content in as it enters the viewport — including content that arrives
 * later from the network, which is why this watches the DOM rather than
 * running once.
 */
function useScrollReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const seen = new WeakSet<Element>()

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).map((e) => e.target)
        if (!visible.length) return
        visible.forEach((t) => io.unobserve(t))
        gsap.to(visible, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.05, overwrite: true, clearProps: 'transform' })
      },
      { rootMargin: '0px 0px -8% 0px' },
    )

    const register = () => {
      el.querySelectorAll(REVEAL).forEach((node) => {
        if (seen.has(node)) return
        // Skip anything nested inside an element that's already animating.
        if (node.parentElement?.closest(REVEAL) && el.contains(node.parentElement.closest(REVEAL))) return
        seen.add(node)
        const top = node.getBoundingClientRect().top
        if (top < window.innerHeight * 0.92) {
          // Already on screen (or scrolled past): ease in now, never leave it hidden.
          if (top > -window.innerHeight) {
            gsap.fromTo(node, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', clearProps: 'transform' })
          }
          return
        }
        gsap.set(node, { opacity: 0, y: 24 })
        io.observe(node)
      })
    }

    register()
    // Safety net: if the observer never fires (background tab, odd browser),
    // nothing stays invisible for long.
    const failsafe = window.setTimeout(() => {
      el.querySelectorAll<HTMLElement>(REVEAL).forEach((n) => {
        if (getComputedStyle(n).opacity === '0') gsap.to(n, { opacity: 1, y: 0, duration: 0.4 })
      })
    }, 4000)
    const mo = new MutationObserver(register)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      window.clearTimeout(failsafe)
      mo.disconnect()
      io.disconnect()
    }
  }, [root])
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void">
      <div className="public-grid absolute -inset-[48px]" />
      <div className="public-glow absolute -left-[20%] -top-[30%] h-[70vh] w-[70vw] rounded-full bg-turf-600/25 blur-[120px]" />
      <div className="public-glow-2 absolute -right-[15%] top-[40%] h-[50vh] w-[45vw] rounded-full bg-volt-400/[0.06] blur-[120px]" />
      {/* Centre circle, faintly, like a pitch seen from above. */}
      <div className="absolute left-1/2 top-[18vh] h-[70vmin] w-[70vmin] -translate-x-1/2 rounded-full border border-chalk/[0.04]" />
      <div className="absolute inset-x-0 top-[calc(18vh+35vmin)] h-px bg-chalk/[0.04]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,transparent_0%,rgb(5_7_6/0.85)_75%)]" />
    </div>
  )
}

export function PublicLayout({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const { pathname, hash } = useLocation()

  // A new page starts at the top — before the reveal checks what's on screen.
  useLayoutEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  useScrollReveal(ref)

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop />
      <PublicNavbar />
      <main ref={ref} id="main" className={cn('flex-1', className)}>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

/** The big title block at the top of each public page. */
export function PublicHero({
  eyebrow,
  title,
  lead,
  icon: Icon,
  media,
  children,
}: {
  eyebrow?: string
  title: ReactNode
  lead?: ReactNode
  icon?: ComponentType<{ className?: string }>
  media?: ReactNode
  children?: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('[data-hero-in]', { y: 20, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'expo.out' })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <header ref={ref} className="px-5 pb-10 pt-12 text-center sm:pt-16">
      {media ?? (Icon && (
        <div data-hero-in className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-volt-400/30 bg-pitch-900/80 shadow-[0_0_40px_-10px_rgb(180_255_57/0.5)]">
          <Icon className="h-7 w-7 text-volt-400" />
        </div>
      ))}
      {eyebrow && (
        <p data-hero-in className="font-display text-[12px] font-semibold uppercase tracking-[0.22em] text-volt-400">{eyebrow}</p>
      )}
      <h1 data-hero-in className="mx-auto mt-3 max-w-2xl text-[clamp(2.25rem,8vw,4rem)] leading-[1]">{title}</h1>
      {lead && (
        <p data-hero-in className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-chalk-muted">{lead}</p>
      )}
      {children && <div data-hero-in>{children}</div>}
    </header>
  )
}
