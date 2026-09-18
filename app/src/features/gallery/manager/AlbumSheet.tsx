import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RiGlobalLine, RiLockLine } from '@remixicon/react'
import { api, ApiError } from '@/services/client'
import { Button, Field, Input } from '@/components/ui'
import { Sheet } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { Album } from '../types'

/** Create or edit an album — title, date, and who can see it. */
export function AlbumSheet({ open, album, onClose, onSaved }: { open: boolean; album: Album | null; onClose: () => void; onSaved: (a: Album, message: string) => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')

  useEffect(() => {
    if (!open) return
    setTitle(album?.title ?? '')
    setDescription(album?.description ?? '')
    setDate(album?.event_date ?? '')
    setVisibility(album?.visibility ?? 'public')
  }, [open, album])

  const save = useMutation({
    mutationFn: async () => {
      const body = { title, description, visibility, event_date: date || null }
      return album ? api.patch<Album>(`gallery/albums/${album.id}`, body) : api.post<Album>('gallery/albums', body)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['gallery'] })
      onSaved(r.data, r.message)
    },
  })
  const err = save.error instanceof ApiError ? save.error : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Sheet open={open} onClose={onClose} title={album ? 'Edit album' : 'New album'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Title" error={err?.field('title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday 14 Sept vs Wuse Rangers" maxLength={80} autoFocus invalid={!!err?.field('title')} />
        </Field>
        <Field label="Date (optional)">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Description (optional)" error={err?.field('description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
        </Field>

        <fieldset>
          <legend className="mb-2 text-[14px] font-medium text-chalk">Who can see it</legend>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: 'public', icon: RiGlobalLine, t: 'Public', d: 'Anyone with the gallery link' },
              { v: 'private', icon: RiLockLine, t: 'Private', d: 'Only signed-in group members' },
            ] as const).map((o) => (
              <label
                key={o.v}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors',
                  visibility === o.v ? 'border-volt-400 bg-volt-400/10' : 'border-pitch-700 hover:border-pitch-600',
                )}
              >
                <input type="radio" name="visibility" value={o.v} checked={visibility === o.v} onChange={() => setVisibility(o.v)} className="sr-only" />
                <o.icon className={cn('h-5 w-5', visibility === o.v ? 'text-volt-400' : 'text-chalk-muted')} />
                <span className="text-[14px] font-medium">{o.t}</span>
                <span className="text-[12px] text-chalk-muted">{o.d}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {save.error && !err?.fieldErrors && <p role="alert" className="text-[14px] text-card-red">{(save.error as Error).message}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} fullWidth>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={!title.trim()} fullWidth>{album ? 'Save' : 'Create album'}</Button>
        </div>
      </form>
    </Sheet>
  )
}
