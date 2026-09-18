import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/client'
import type { Album, DownloadLink, TeamMedia } from '../types'
import { startDownloads } from '../shared/media'

export interface MediaFilters {
  view?: 'trash'
  album?: string | null
  type?: 'image' | 'video' | ''
  sort?: 'recent' | 'oldest' | 'popular' | 'largest'
  mine?: boolean
  q?: string
}

const PER_PAGE = 40

export function useAlbums() {
  return useQuery({
    queryKey: ['gallery', 'albums'],
    queryFn: async () => (await api.get<{ albums: Album[]; unsorted: { photos: number; videos: number } }>('gallery/albums')).data,
  })
}

export function useMedia(filters: MediaFilters) {
  return useInfiniteQuery({
    queryKey: ['gallery', 'media', filters],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<TeamMedia[]>('gallery/media', {
        page: pageParam,
        per_page: PER_PAGE,
        view: filters.view,
        album: filters.album ?? undefined,
        type: filters.type || undefined,
        sort: filters.sort,
        mine: filters.mine ? 1 : undefined,
        q: filters.q || undefined,
      })
      return { items: r.data, meta: r.meta as { page: number; total_pages: number; total: number } }
    },
    getNextPageParam: (last) => (last.meta.page < last.meta.total_pages ? last.meta.page + 1 : undefined),
  })
}

type Notify = (text: string, tone?: 'ok' | 'bad') => void

function useAction<B>(path: string, onMessage: Notify) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: B) => api.post<Record<string, number>>(path, body),
    onSuccess: (r) => {
      onMessage(r.message)
      qc.invalidateQueries({ queryKey: ['gallery'] })
    },
    onError: (e: Error) => onMessage(e.message, 'bad'),
  })
}

/** Every bulk action, each refreshing the gallery and storage afterwards. */
export function useMediaActions(onMessage: Notify) {

  const download = useMutation({
    mutationFn: (ids: string[]) => api.post<{ links: DownloadLink[] }>('gallery/media/download', { ids }),
    onSuccess: (r) => {
      startDownloads(r.data.links)
      onMessage(r.data.links.length > 1 ? `Downloading in ${r.data.links.length} parts` : 'Download started')
    },
    onError: (e: Error) => onMessage(e.message, 'bad'),
  })

  return {
    trash: useAction<{ ids: string[] }>('gallery/media/trash', onMessage),
    restore: useAction<{ ids: string[] }>('gallery/media/restore', onMessage),
    purge: useAction<{ ids: string[] }>('gallery/media/purge', onMessage),
    emptyTrash: useAction<Record<string, never>>('gallery/media/empty-trash', onMessage),
    move: useAction<{ ids: string[]; album_id: string | null }>('gallery/media/move', onMessage),
    compress: useAction<{ ids: string[] }>('gallery/media/compress', onMessage),
    download,
  }
}
