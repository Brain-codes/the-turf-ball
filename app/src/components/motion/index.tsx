/**
 * Motion primitives. SPEC.md §15.
 *
 * The rule that governs everything here: if everything moves, nothing is
 * important. Motion is reserved for moments that carry meaning — a goal, a rank
 * change, an award. Navigation and forms stay quick and quiet.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* -------------------------------------------------------------------------- */
/* Tier 0 — functional. Invisible by design.                                   */
/* -------------------------------------------------------------------------- */

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tier 1 — signature moments                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Statistics count up rather than snapping. The eye follows the change, which
 * is the point: you should see that a number moved, not just that it differs.
 */
export function CountUp({
  value,
  duration = 800,
  className,
}: {
  value: number
  duration?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }

    const from = fromRef.current
    const delta = value - from
    if (delta === 0) return

    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      // Ease-out cubic: fast first, settling gently — reads as decisive.
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(from + delta * eased))
      if (progress < 1) frameRef.current = requestAnimationFrame(tick)
      else fromRef.current = value
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, duration, reduced])

  return <span className={cn('tabular', className)}>{display}</span>
}

/**
 * The goal celebration. A full-screen moment, because a goal IS the moment —
 * but interruptible and short, because the organizer needs the screen back.
 */
export function GoalBurst({
  show,
  scorer,
  assister,
  onDone,
}: {
  show: boolean
  scorer: string
  assister?: string | null
  onDone: () => void
}) {
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!show) return
    const timer = setTimeout(onDone, reduced ? 700 : 1600)
    return () => clearTimeout(timer)
  }, [show, onDone, reduced])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="goal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          // Tapping anywhere dismisses it — never make someone wait out an
          // animation while a game is going on.
          onClick={onDone}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-void/92 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="numeric text-[clamp(4rem,22vw,9rem)] leading-none text-volt-400"
            style={{ textShadow: '0 0 60px rgba(180,255,57,0.45)' }}
          >
            GOAL
          </motion.div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.16, duration: 0.34 }}
            className="mt-4 text-center"
          >
            <div className="text-2xl font-bold text-chalk">{scorer}</div>
            {assister && (
              <div className="mt-1 text-[15px] text-chalk-muted">assist by {assister}</div>
            )}
          </motion.div>

          {!reduced && <Particles />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Particles() {
  // Deterministic spread so the burst looks designed rather than random noise.
  const pieces = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2
    return { x: Math.cos(angle) * (120 + (i % 4) * 40), y: Math.sin(angle) * (120 + (i % 3) * 50) }
  })

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
          transition={{ duration: 1.1, delay: i * 0.012, ease: 'easeOut' }}
          className="absolute h-2 w-2 rounded-full bg-volt-400"
        />
      ))}
    </div>
  )
}

/** Kick-off countdown. Short, and skippable. */
export function Countdown({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(3)

  useEffect(() => {
    if (reduced) {
      onDone()
      return
    }
    if (n === 0) {
      const t = setTimeout(onDone, 600)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setN((v) => v - 1), 700)
    return () => clearTimeout(t)
  }, [n, onDone, reduced])

  if (reduced) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void" onClick={onDone}>
      <AnimatePresence mode="wait">
        <motion.div
          key={n}
          initial={{ scale: 1.8, opacity: 0, filter: 'blur(8px)' }}
          animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
          exit={{ scale: 0.6, opacity: 0, filter: 'blur(8px)' }}
          transition={{ duration: 0.32 }}
          className="numeric text-volt-400"
          style={{ fontSize: n === 0 ? 'clamp(3rem,14vw,7rem)' : 'clamp(6rem,30vw,14rem)' }}
        >
          {n === 0 ? 'KICK OFF' : n}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/**
 * The undo toast. The draining ring is doing real work: it shows exactly how
 * long is left to take the tap back, so nobody has to guess.
 */
export function UndoToast({
  show,
  label,
  seconds = 5,
  onUndo,
  onExpire,
  liftAboveActionBar,
}: {
  show: boolean
  label: string
  seconds?: number
  onUndo: () => void
  onExpire: () => void
  /** True while a bottom action bar is also on screen, so the toast floats above it instead of covering it. */
  liftAboveActionBar?: boolean
}) {
  const [remaining, setRemaining] = useState(seconds)

  // The caller (MatchDay's LiveMatch) re-renders every second because its
  // own match clock ticks — onExpire/onUndo are inline arrow functions that
  // get a new identity on every one of those renders. Depending on them
  // directly meant this effect tore down and restarted its timers every
  // ~1s, permanently resetting the countdown before it could ever reach
  // zero — the toast looked stuck and never closed itself. Refs decouple
  // the timers from the caller's render cadence; only a real show/seconds
  // change should restart the countdown.
  const onExpireRef = useRef(onExpire)
  const onUndoRef = useRef(onUndo)
  useEffect(() => {
    onExpireRef.current = onExpire
    onUndoRef.current = onUndo
  })

  useEffect(() => {
    if (!show) return
    setRemaining(seconds)
    const t = setTimeout(() => onExpireRef.current(), seconds * 1000)
    const tick = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => {
      clearTimeout(t)
      clearInterval(tick)
    }
  }, [show, seconds])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={cn(
            'fixed inset-x-3 z-40 flex items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 px-4 py-3 shadow-2xl',
            liftAboveActionBar ? 'bottom-44' : 'bottom-3 safe-bottom',
          )}
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-pitch-700)" strokeWidth="4" />
              <motion.circle
                cx="18" cy="18" r="15" fill="none"
                stroke="var(--color-volt-400)" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={94}
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: 94 }}
                transition={{ duration: seconds, ease: 'linear' }}
              />
            </svg>
            <span className="numeric relative text-[11px] font-bold text-chalk">{remaining}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] text-chalk">{label}</span>
          <button
            onClick={onUndo}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold uppercase tracking-wider text-volt-400 hover:bg-volt-400/10"
          >
            Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Bottom sheet on mobile, centred dialog on desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-void/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-pitch-700 bg-pitch-900 p-5 safe-bottom',
              'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(30rem,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border',
            )}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-pitch-700 sm:hidden" />
            {title && <h2 className="mb-4 text-xl">{title}</h2>}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export { motion, AnimatePresence }
