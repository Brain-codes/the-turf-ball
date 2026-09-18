import { useState } from 'react'
import { RiArrowDownSLine, RiArrowUpSLine, RiCheckLine, RiCloseLine, RiErrorWarningLine, RiRefreshLine, RiUploadCloud2Line } from '@remixicon/react'
import { AnimatePresence, motion } from '@/components/motion'
import { cn } from '@/lib/cn'
import { formatBytes } from '../shared/media'
import { useUploads, type UploadItem } from './uploads'

const LABEL: Record<UploadItem['status'], string> = {
  queued: 'Waiting',
  preparing: 'Preparing',
  uploading: 'Uploading',
  saving: 'Saving',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
}

/** Floating tray that follows the uploader around the gallery. */
export function UploadQueue() {
  const { items, cancel, retry, clearFinished, saveSpace, setSaveSpace } = useUploads()
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null

  const running = items.filter((i) => ['queued', 'preparing', 'uploading', 'saving'].includes(i.status))
  const failed = items.filter((i) => i.status === 'error').length
  const totalBytes = running.reduce((n, i) => n + i.size, 0)
  const doneBytes = running.reduce((n, i) => n + i.size * i.progress, 0)
  const overall = totalBytes ? doneBytes / totalBytes : 1

  return (
    <motion.section
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      aria-label="Uploads"
      className="fixed inset-x-3 bottom-24 z-40 overflow-hidden rounded-2xl border border-pitch-700 bg-pitch-900/95 shadow-2xl backdrop-blur-xl md:inset-x-auto md:bottom-6 md:right-6 md:w-96"
    >
      <header className="flex items-center gap-3 px-4 py-3">
        <RiUploadCloud2Line className="h-5 w-5 text-volt-400" />
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-[14px] font-medium">
            {running.length ? `Uploading ${running.length} file${running.length === 1 ? '' : 's'}` : failed ? `${failed} upload${failed === 1 ? '' : 's'} failed` : 'All uploaded'}
          </p>
          {running.length > 0 && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pitch-700">
              <div className="h-full origin-left rounded-full bg-volt-400 transition-transform duration-300" style={{ transform: `scaleX(${overall})` }} />
            </div>
          )}
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Show uploads' : 'Hide uploads'} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-chalk-muted hover:text-chalk">
          {collapsed ? <RiArrowUpSLine className="h-5 w-5" /> : <RiArrowDownSLine className="h-5 w-5" />}
        </button>
        {running.length === 0 && (
          <button type="button" onClick={clearFinished} aria-label="Close uploads" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-chalk-muted hover:text-chalk">
            <RiCloseLine className="h-5 w-5" />
          </button>
        )}
      </header>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-pitch-700 px-4 py-2.5 text-[13px] text-chalk-muted">
              <span>Save space — shrink photos before upload</span>
              <input type="checkbox" checked={saveSpace} onChange={(e) => setSaveSpace(e.target.checked)} className="h-5 w-5 accent-[var(--color-volt-400)]" />
            </label>
            <ul className="max-h-72 overflow-y-auto border-t border-pitch-700">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px]">{i.name}</p>
                    <p className={cn('text-[12px]', i.status === 'error' ? 'text-card-red' : 'text-chalk-faint')}>
                      {i.status === 'error' ? i.error : `${LABEL[i.status]} · ${formatBytes(i.size)}${i.status === 'uploading' ? ` · ${Math.round(i.progress * 100)}%` : ''}`}
                    </p>
                    {['uploading', 'saving', 'preparing'].includes(i.status) && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pitch-700">
                        <div className="h-full origin-left rounded-full bg-turf-400 transition-transform duration-200" style={{ transform: `scaleX(${i.progress})` }} />
                      </div>
                    )}
                  </div>
                  {i.status === 'done' && <RiCheckLine aria-label="Done" className="h-5 w-5 text-turf-400" />}
                  {i.status === 'error' && (
                    <button type="button" onClick={() => retry(i.id)} aria-label={`Retry ${i.name}`} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-chalk-muted hover:text-chalk">
                      <RiRefreshLine className="h-[18px] w-[18px]" />
                    </button>
                  )}
                  {['queued', 'preparing', 'uploading'].includes(i.status) && (
                    <button type="button" onClick={() => cancel(i.id)} aria-label={`Cancel ${i.name}`} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-chalk-muted hover:text-card-red">
                      <RiCloseLine className="h-[18px] w-[18px]" />
                    </button>
                  )}
                  {i.status === 'error' && <RiErrorWarningLine aria-hidden className="h-5 w-5 text-card-red" />}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
