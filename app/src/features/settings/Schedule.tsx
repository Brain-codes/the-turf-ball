/**
 * Schedule settings — the group's recurring session times.
 *
 * Replaces the original assumption of one playing day at one fixed time. A
 * group can have as many slots as it likes, including two on the same day: a
 * Sunday morning kickabout and a Sunday evening game are separate fixtures.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  Badge, Button, Card, EmptyState, Field, Input, SectionTitle, Skeleton,
} from '@/components/ui'
import { FadeIn, Sheet } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { SessionSlot } from '@/types'

const DAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
]

/** '17:00:00' -> '5:00 PM' */
export function prettyTime(value: string): string {
  const [h, m] = value.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

export function ScheduleSettings() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<SessionSlot | 'new' | null>(null)

  const { data: slots, isLoading } = useQuery({
    queryKey: ['slots', activeOrg?.id],
    queryFn: async () => (await api.get<SessionSlot[]>(`organizations/${activeOrg!.id}/slots`)).data,
    enabled: !!activeOrg,
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`organizations/${activeOrg!.id}/slots/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['slots'] }),
  })

  const isAdmin = activeOrg?.role === 'owner' || activeOrg?.role === 'admin'

  // Group by day so a Sunday with two times reads as one day, not two rows.
  const byDay = DAYS.map((day) => ({
    ...day,
    slots: (slots ?? []).filter((s) => s.weekday === day.value),
  })).filter((day) => day.slots.length > 0)

  return (
    <FadeIn className="space-y-6">
      <Card>
        <p className="text-[13.5px] leading-relaxed text-chalk-muted">
          Your regular session times. Add as many as you play — different days, or the same day
          twice for a morning and an evening game. These become one-tap options when you start a
          session, and you can still book a one-off any time.
        </p>
      </Card>

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (slots ?? []).length === 0 ? (
        <EmptyState
          icon="📅"
          title="No regular times yet"
          description="Add the days and times you usually play."
          action={isAdmin && <Button onClick={() => setEditing('new')}>Add a session time</Button>}
        />
      ) : (
        <div className="space-y-5">
          {byDay.map((day) => (
            <div key={day.value}>
              <SectionTitle>{day.label}</SectionTitle>
              <div className="space-y-2">
                {day.slots.map((slot) => (
                  <Card
                    key={slot.id}
                    className={cn(
                      'flex items-center gap-3',
                      !slot.is_active && 'opacity-50',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="numeric text-[17px] text-chalk">
                          {prettyTime(slot.kickoff)}
                        </span>
                        {!slot.is_active && <Badge>Paused</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-chalk-muted">
                        {slot.label || 'No name'}
                        {slot.venue && ` · ${slot.venue}`}
                      </span>
                    </span>
                    {isAdmin && (
                      <>
                        <button
                          onClick={() =>
                            toggleActive.mutate({ id: slot.id, is_active: !slot.is_active })
                          }
                          className="text-[13px] text-chalk-muted hover:text-chalk"
                        >
                          {slot.is_active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => setEditing(slot)}
                          className="text-[13px] text-volt-400"
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}

          {isAdmin && (
            <Button variant="secondary" fullWidth onClick={() => setEditing('new')}>
              Add another session time
            </Button>
          )}
        </div>
      )}

      {editing && (
        <SlotSheet
          slot={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['slots'] })
            queryClient.invalidateQueries({ queryKey: ['upcoming-slots'] })
            setEditing(null)
          }}
        />
      )}
    </FadeIn>
  )
}

function SlotSheet({
  slot,
  onClose,
  onSaved,
}: {
  slot: SessionSlot | null
  onClose: () => void
  onSaved: () => void
}) {
  const { activeOrg } = useAuth()
  const [form, setForm] = useState({
    weekday: slot?.weekday ?? 0,
    kickoff: (slot?.kickoff ?? '17:00:00').slice(0, 5),
    label: slot?.label ?? '',
    venue: slot?.venue ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        weekday: form.weekday,
        kickoff: form.kickoff,
        label: form.label.trim() || null,
        venue: form.venue.trim() || null,
      }
      return slot
        ? api.patch(`organizations/${activeOrg!.id}/slots/${slot.id}`, payload)
        : api.post(`organizations/${activeOrg!.id}/slots`, payload)
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save that'),
  })

  const remove = useMutation({
    mutationFn: async () => api.del(`organizations/${activeOrg!.id}/slots/${slot!.id}`),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not remove that'),
  })

  return (
    <Sheet open onClose={onClose} title={slot ? 'Edit session time' : 'Add a session time'}>
      <div className="space-y-4">
        <Field label="Which day?">
          <div className="grid grid-cols-4 gap-2">
            {DAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => setForm({ ...form, weekday: day.value })}
                className={cn(
                  'h-11 rounded-lg border text-[14px] transition-colors',
                  form.weekday === day.value
                    ? 'border-volt-400 bg-volt-400/15 font-semibold text-volt-400'
                    : 'border-pitch-700 bg-pitch-900 text-chalk-muted hover:border-pitch-600',
                )}
              >
                {day.short}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Kick-off time">
          <Input
            type="time"
            value={form.kickoff}
            onChange={(e) => setForm({ ...form, kickoff: e.target.value })}
          />
        </Field>

        <Field
          label="Name it"
          hint="Optional — useful when you play twice in a day, e.g. 'Sunday Morning'"
        >
          <Input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Sunday Evening"
            maxLength={40}
          />
        </Field>

        <Field label="Venue" hint="Leave blank to use your group's usual ground">
          <Input
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
            placeholder="XYZ Football Arena"
          />
        </Field>

        {error && <p className="text-[14px] text-card-red">{error}</p>}

        <Button size="lg" fullWidth loading={save.isPending} onClick={() => save.mutate()}>
          {slot ? 'Save changes' : 'Add session time'}
        </Button>

        {slot && (
          confirmDelete ? (
            <div className="rounded-xl border border-card-red/40 bg-card-red/5 p-3.5">
              <p className="text-[14px] text-chalk">
                Remove this session time? Sessions you've already played at this time keep all their
                results.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" fullWidth loading={remove.isPending} onClick={() => remove.mutate()}>
                  Yes, remove
                </Button>
                <Button variant="ghost" fullWidth onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" fullWidth onClick={() => setConfirmDelete(true)}>
              Remove this session time
            </Button>
          )
        )}
      </div>
    </Sheet>
  )
}
