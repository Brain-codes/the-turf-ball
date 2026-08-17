/**
 * Self-serve player invite — the public, unauthenticated counterpart to
 * onboarding step 3's "Add your squad". Reached via `/play/:slug`, the link
 * an admin copies and drops in a group chat. Submitting creates a `players`
 * row with status = 'pending' (public/handlers/publicJoin.ts); the admin
 * approves or rejects it from the onboarding pending queue or Settings.
 */

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, request } from '@/services/client'
import { Button, Card, EmptyState, Field, Input, PositionSelect, Select } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { compressImage } from '@/lib/file'

const FEET = [
  { value: '', label: 'No preference' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
]

export function JoinTeamScreen() {
  const { slug } = useParams<{ slug: string }>()
  const [form, setForm] = useState({
    first_name: '',
    display_name: '',
    whatsapp_nickname: '',
    preferred_foot: '',
    position: '',
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function submit() {
    if (form.first_name.trim().length < 1) return
    setBusy(true)
    setError(null)
    // api.public() only issues GET requests. This is the one deliberate
    // write path in the public function (publicJoin.ts), so it calls the
    // shared request() helper directly with anonymous:true and POST —
    // still going through the same baseline-anon-key request shape as
    // every other unauthenticated call (client.ts).
    try {
      const photo_base64 = photoFile ? await compressImage(photoFile) : undefined
      const { message } = await request<{ id: string; display_name: string }>(`public/${slug}/join`, {
        method: 'POST',
        anonymous: true,
        body: {
          first_name: form.first_name.trim(),
          display_name: form.display_name.trim() || undefined,
          whatsapp_nickname: form.whatsapp_nickname.trim() || undefined,
          preferred_foot: form.preferred_foot || undefined,
          position: form.position || undefined,
          photo_base64,
        },
      })
      setDone(message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit that. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="pitch-lines flex min-h-dvh items-center justify-center px-5">
        <div className="mx-auto w-full max-w-md text-center">
          <div className="mb-4 text-6xl">⚽</div>
          <h1 className="text-2xl text-chalk">You're in the queue</h1>
          <p className="mt-2 text-[15px] text-chalk-muted">{done}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pitch-lines min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <FadeIn>
          <h1 className="text-3xl">Join the squad</h1>
          <p className="mt-2 mb-7 text-[15px] text-chalk-muted">
            Add your details — the group's admin will approve you before you show up in the squad.
          </p>

          <Card className="space-y-4">
            <Field label="Your name">
              <Input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                placeholder="Ade Adeyemi"
                autoFocus
              />
            </Field>
            <Field label="Kit / nickname" hint="Optional — what shows on the leaderboard">
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Ade"
              />
            </Field>
            <Field label="Preferred foot">
              <Select
                value={form.preferred_foot}
                onChange={(e) => setForm({ ...form, preferred_foot: e.target.value })}
              >
                {FEET.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </Field>
            <Field label="Position" hint="Optional">
              <PositionSelect
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </Field>
            <Field label="WhatsApp nickname" hint="Optional — the name you go by in the group chat">
              <Input
                value={form.whatsapp_nickname}
                onChange={(e) => setForm({ ...form, whatsapp_nickname: e.target.value })}
                placeholder="Ade Turf Ball"
              />
            </Field>
            <Field label="Photo" hint="Optional">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[16px] text-chalk-muted file:mr-3 file:rounded-lg file:border-0 file:bg-pitch-700 file:px-3 file:py-2 file:text-[13px] file:text-chalk"
              />
            </Field>

            {error && <p className="text-[14px] text-card-red">{error}</p>}

            <Button
              size="lg"
              fullWidth
              loading={busy}
              disabled={form.first_name.trim().length < 1}
              onClick={submit}
            >
              Request to join
            </Button>
          </Card>

          {!slug && (
            <div className="mt-6">
              <EmptyState icon="⚠️" title="Missing invite link" description="This link looks incomplete." />
            </div>
          )}
        </FadeIn>
      </div>
    </div>
  )
}
