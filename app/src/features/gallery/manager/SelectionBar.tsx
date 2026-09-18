import type { ReactNode } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { AnimatePresence, motion } from '@/components/motion'
import { cn } from '@/lib/cn'

/** Sticky action bar that slides up while anything is selected. */
export function SelectionBar({ count, onClear, onSelectAll, children }: { count: number; onClear: () => void; onSelectAll?: () => void; children: ReactNode }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
          role="toolbar"
          aria-label={`${count} selected`}
          className="fixed inset-x-3 bottom-24 z-40 flex items-center gap-1 overflow-x-auto rounded-2xl border border-volt-400/30 bg-pitch-900/95 p-1.5 shadow-2xl backdrop-blur-xl md:bottom-6 md:left-1/2 md:right-auto md:-translate-x-1/2"
        >
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-chalk-muted hover:text-chalk">
            <RiCloseLine className="h-5 w-5" />
          </button>
          <span className="shrink-0 px-1 text-[14px] font-semibold tabular">{count} selected</span>
          {onSelectAll && (
            <button type="button" onClick={onSelectAll} className="h-11 shrink-0 cursor-pointer rounded-xl px-3 text-[13.5px] text-chalk-muted hover:text-chalk">
              Select all
            </button>
          )}
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-pitch-700" />
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function BarAction({ icon, label, onClick, danger, busy, disabled }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        'flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:h-[18px] [&>svg]:w-[18px]',
        danger ? 'text-card-red hover:bg-card-red/10' : 'text-chalk hover:bg-pitch-800',
        busy && 'animate-pulse',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
