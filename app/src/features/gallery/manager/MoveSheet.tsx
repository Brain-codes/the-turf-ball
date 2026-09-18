import { RiFolderLine, RiInboxLine, RiLockLine } from '@remixicon/react'
import { Sheet } from '@/components/motion'
import type { Album } from '../types'

/** Pick where selected files should go. */
export function MoveSheet({ open, albums, count, onClose, onPick }: { open: boolean; albums: Album[]; count: number; onClose: () => void; onPick: (albumId: string | null) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={`Move ${count} item${count === 1 ? '' : 's'} to…`}>
      <ul className="-mx-2 max-h-[55vh] overflow-y-auto">
        <li>
          <button type="button" onClick={() => onPick(null)} className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left hover:bg-pitch-800">
            <RiInboxLine className="h-5 w-5 text-chalk-muted" /> Unsorted <span className="ml-auto text-[12px] text-chalk-faint">public</span>
          </button>
        </li>
        {albums.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onPick(a.id)} className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left hover:bg-pitch-800">
              <RiFolderLine className="h-5 w-5 text-volt-400" />
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              {a.visibility === 'private' && <RiLockLine aria-label="Private" className="h-4 w-4 text-chalk-muted" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
