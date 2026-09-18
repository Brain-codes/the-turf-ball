import { RiAddLine, RiFolderImageLine, RiGlobalLine, RiLockLine, RiMoreLine, RiPencilLine } from '@remixicon/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/client'
import { Button, EmptyState } from '@/components/ui'
import { Stagger, StaggerItem } from '@/components/motion'
import { fullDate } from '@/lib/format'
import { thumbUrl } from '../shared/media'
import type { Album } from '../types'

export function AlbumsView({
  albums,
  unsorted,
  canEdit,
  onOpen,
  onCreate,
  onEdit,
  notify,
}: {
  albums: Album[]
  unsorted: { photos: number; videos: number }
  canEdit: (a: Album) => boolean
  onOpen: (id: string | 'none') => void
  onCreate: () => void
  onEdit: (a: Album) => void
  notify: (text: string, tone?: 'ok' | 'bad') => void
}) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`gallery/albums/${id}`),
    onSuccess: (r) => {
      notify(r.message)
      qc.invalidateQueries({ queryKey: ['gallery'] })
    },
    onError: (e: Error) => notify(e.message, 'bad'),
  })

  if (albums.length === 0 && unsorted.photos + unsorted.videos === 0) {
    return (
      <EmptyState
        icon={<RiFolderImageLine className="mx-auto h-10 w-10" />}
        title="No albums yet"
        description="Group photos by match day or event. Each album can be public or members-only."
        action={<Button onClick={onCreate}><RiAddLine className="h-4 w-4" /> New album</Button>}
      />
    )
  }

  return (
    <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StaggerItem>
        <button type="button" onClick={onCreate} className="flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-pitch-700 text-chalk-muted transition-colors hover:border-volt-400/60 hover:text-chalk">
          <RiAddLine className="h-7 w-7" />
          <span className="text-[14px] font-medium">New album</span>
        </button>
      </StaggerItem>
      {albums.map((a) => (
        <StaggerItem key={a.id}>
          <AlbumCard
            album={a}
            onOpen={() => onOpen(a.id)}
            onEdit={canEdit(a) ? () => onEdit(a) : undefined}
            onDelete={canEdit(a) ? () => window.confirm(`Delete “${a.title}”? The photos and videos in it stay — they move to Unsorted.`) && remove.mutate(a.id) : undefined}
          />
        </StaggerItem>
      ))}
      {unsorted.photos + unsorted.videos > 0 && (
        <StaggerItem>
          <AlbumCard
            album={{ id: 'none', title: 'Unsorted', description: null, visibility: 'public', event_date: null, cover: null, ...unsorted }}
            onOpen={() => onOpen('none')}
          />
        </StaggerItem>
      )}
    </Stagger>
  )
}

function AlbumCard({ album: a, onOpen, onEdit, onDelete }: { album: Album; onOpen: () => void; onEdit?: () => void; onDelete?: () => void | false }) {
  return (
    <div className="group relative">
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-pitch-800">
          {a.cover?.urls.thumb ? (
            <img src={thumbUrl(a.cover)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="flex h-full items-center justify-center"><RiFolderImageLine className="h-10 w-10 text-pitch-600" /></div>
          )}
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-void/70 px-2 py-0.5 text-[11.5px] text-chalk backdrop-blur">
            {a.visibility === 'private' ? <><RiLockLine className="h-3.5 w-3.5" /> Members</> : <><RiGlobalLine className="h-3.5 w-3.5 text-volt-400" /> Public</>}
          </span>
        </div>
        <p className="mt-2 truncate text-[15px] font-semibold">{a.title}</p>
        <p className="text-[12.5px] text-chalk-muted">
          {a.photos} photo{a.photos === 1 ? '' : 's'} · {a.videos} video{a.videos === 1 ? '' : 's'}
          {a.event_date ? ` · ${fullDate(a.event_date)}` : ''}
        </p>
      </button>
      {(onEdit || onDelete) && (
        <details className="absolute right-1.5 top-1.5">
          <summary aria-label={`Options for ${a.title}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full bg-void/60 text-chalk backdrop-blur hover:bg-void/80">
            <RiMoreLine className="h-5 w-5" />
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-xl border border-pitch-700 bg-pitch-900 py-1 shadow-xl">
            {onEdit && <button type="button" onClick={onEdit} className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-[14px] hover:bg-pitch-800"><RiPencilLine className="h-4 w-4" /> Edit</button>}
            {onDelete && <button type="button" onClick={() => onDelete()} className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-[14px] text-card-red hover:bg-pitch-800">Delete album</button>}
          </div>
        </details>
      )}
    </div>
  )
}
