/**
 * Onboarding — 4-step wizard. SPEC.md §5.1 sets the "fast to finish" bar;
 * this rebuild trades the old single-day, name-only version for something
 * that actually gets a real group's schedule and squad in before they land
 * on the dashboard.
 *
 * Rebuilt 16 Aug (session 3) — the previous 5-step onboarding (single
 * kickoff-only schedule step, names-only player step) is now obsolete. See
 * HANDOFF.md for why: it captured one day/time per group and never asked
 * for an end time, so `session_slots.duration_minutes` was always the
 * 90-minute default even for groups that play two-hour sessions.
 *
 * Step 1 — Team          (unchanged: name, format, venue)
 * Step 2 — Schedule       multi-day, multi-slot, shared OR per-day times
 * Step 3 — Players        manual add (with photo/foot/kit name) + a
 *                         copyable self-serve invite link + a live
 *                         pending-approval queue
 * Step 4 — Review         schedule + squad + next-session preview, then
 *                         straight to the dashboard with zero further setup
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, setActiveOrg } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Badge, Button, Card, Field, Input, PlayerAvatar, PositionSelect, Select } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { cn } from '@/lib/cn'
import { countdown } from '@/lib/format'
import { compressImage } from '@/lib/file'
import { minutesBetween } from '@/lib/time'
import type { Organization, Player, UpcomingSlot } from '@/types'

const WEEKDAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
]

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-8 flex justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === step ? 'w-8 bg-volt-400' : i < step ? 'w-1.5 bg-turf-500' : 'w-1.5 bg-pitch-700'
          }`}
        />
      ))}
    </div>
  )
}



export function Onboarding() {
  const navigate = useNavigate()
  const { refresh, profile } = useAuth()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)

  const [details, setDetails] = useState({
    name: '',
    venue: '',
    location: '',
    format: '5aside',
  })

  // Schedule: pick several weekdays, then either one shared kickoff+end
  // applied to all of them, or a distinct kickoff+end per day. Real groups
  // like the user's own (Tue/Thu 6-8pm) need both days AND an end time —
  // the old onboarding only ever captured one kickoff.
  const [scheduleMode, setScheduleMode] = useState<'shared' | 'perday'>('shared')
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [shared, setShared] = useState({ start: '18:00', end: '20:00' })
  const [perDay, setPerDay] = useState<Record<number, { start: string; end: string }>>({})

  const [preset] = useState('balanced')
  const [addedPlayers, setAddedPlayers] = useState<Player[]>([])

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  function toggleDay(day: number) {
    setSelectedDays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    )
    setPerDay((p) => (p[day] ? p : { ...p, [day]: { start: '18:00', end: '20:00' } }))
  }

  async function createGroup() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<Organization>('organizations', {
        name: details.name,
        venue: details.venue || null,
        location: details.location || null,
        format: details.format,
        players_per_side: details.format === '5aside' ? 5 : details.format === '7aside' ? 7 : 11,
      })
      setOrg(data)
      setActiveOrg(data.id)
      // Marks the wizard as still in progress. `refresh()` below makes
      // `needsOnboarding` flip to false the instant the org exists (it just
      // checks organizations.length > 0), and the /onboarding route guard
      // reacts to that on every render — without this flag it would bounce
      // straight to /app after step 1, before steps 2-4 ever render.
      sessionStorage.setItem('tb_onboarding_active', '1')
      await refresh()
      setStep(1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your group')
    } finally {
      setBusy(false)
    }
  }

  async function saveSchedule() {
    if (selectedDays.length === 0) {
      setStep(2)
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const day of selectedDays) {
        const times = scheduleMode === 'shared' ? shared : perDay[day] ?? shared
        const duration = minutesBetween(times.start, times.end)
        try {
          await api.post(`organizations/${org!.id}/slots`, {
            weekday: day,
            kickoff: times.start,
            duration_minutes: duration,
          })
        } catch (err) {
          // Duplicate day+time is a 409 — harmless, skip rather than block setup.
          if (!(err instanceof ApiError && err.status === 409)) throw err
        }
      }
      setStep(2)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your schedule')
    } finally {
      setBusy(false)
    }
  }

  async function saveScoringAndFinish() {
    setBusy(true)
    try {
      await api.put('scoring/rules', { preset })
    } catch {
      // Scoring already has sensible defaults — never block finishing setup.
    } finally {
      setBusy(false)
      setStep(3)
    }
  }

  return (
    <div className="pitch-lines min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <StepDots step={step} total={4} />

        {step === 0 && (
          <FadeIn key="step0">
            <h1 className="text-3xl">Hi {firstName} 👋</h1>
            <p className="mt-2 mb-7 text-[15px] text-chalk-muted">
              Let's set up your football group. This takes about a minute.
            </p>

            <div className="space-y-4">
              <Field label="What's your group called?">
                <Input
                  value={details.name}
                  onChange={(e) => setDetails({ ...details, name: e.target.value })}
                  placeholder="Abuja Sunday Ballers"
                  autoFocus
                />
              </Field>

              <Field label="Format">
                <Select
                  value={details.format}
                  onChange={(e) => setDetails({ ...details, format: e.target.value })}
                >
                  <option value="5aside">5-a-side</option>
                  <option value="7aside">7-a-side</option>
                  <option value="11aside">11-a-side</option>
                  <option value="custom">Something else</option>
                </Select>
              </Field>

              <Field label="Where do you play?" hint="Optional — you can add it later">
                <Input
                  value={details.venue}
                  onChange={(e) => setDetails({ ...details, venue: e.target.value })}
                  placeholder="XYZ Football Arena"
                />
              </Field>

              {error && <p className="text-[14px] text-card-red">{error}</p>}

              <Button
                size="lg"
                fullWidth
                loading={busy}
                disabled={details.name.trim().length < 2}
                onClick={createGroup}
              >
                Continue
              </Button>
            </div>
          </FadeIn>
        )}

        {step === 1 && (
          <FadeIn key="step1schedule">
            <h1 className="text-3xl">When do you play?</h1>
            <p className="mt-2 mb-7 text-[15px] text-chalk-muted">
              Pick every day you play, then set the kick-off and finish time — a Sunday morning and
              a Sunday evening are two separate slots, so pick the days first if they differ.
            </p>

            <Field label="Which days?">
              <div className="grid grid-cols-4 gap-2">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={cn(
                      'h-11 rounded-lg border text-[14px] transition-colors',
                      selectedDays.includes(day.value)
                        ? 'border-volt-400 bg-volt-400/15 font-semibold text-volt-400'
                        : 'border-pitch-700 bg-pitch-900 text-chalk-muted hover:border-pitch-600',
                    )}
                  >
                    {day.short}
                  </button>
                ))}
              </div>
            </Field>

            {selectedDays.length > 1 && (
              <div className="mt-4 flex gap-2 rounded-lg bg-pitch-900 p-1">
                <button
                  type="button"
                  onClick={() => setScheduleMode('shared')}
                  className={cn(
                    'flex-1 rounded-md py-2 text-[13px] font-medium transition-colors',
                    scheduleMode === 'shared' ? 'bg-pitch-700 text-chalk' : 'text-chalk-muted',
                  )}
                >
                  Same time every day
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode('perday')}
                  className={cn(
                    'flex-1 rounded-md py-2 text-[13px] font-medium transition-colors',
                    scheduleMode === 'perday' ? 'bg-pitch-700 text-chalk' : 'text-chalk-muted',
                  )}
                >
                  Different times
                </button>
              </div>
            )}

            {selectedDays.length > 0 && (
              <div className="mt-4 space-y-3">
                {scheduleMode === 'shared' || selectedDays.length === 1 ? (
                  <Card className="flex items-end gap-3">
                    <div className="flex-1">
                      <Field label="Kick off">
                        <Input
                          type="time"
                          value={shared.start}
                          onChange={(e) => setShared({ ...shared, start: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex-1">
                      <Field label="Finish">
                        <Input
                          type="time"
                          value={shared.end}
                          onChange={(e) => setShared({ ...shared, end: e.target.value })}
                        />
                      </Field>
                    </div>
                  </Card>
                ) : (
                  selectedDays.map((day) => (
                    <Card key={day} className="flex items-end gap-3">
                      <span className="w-14 shrink-0 pb-2.5 text-[14px] text-chalk-muted">
                        {WEEKDAYS[day].short}
                      </span>
                      <div className="flex-1">
                        <Field label="Kick off">
                          <Input
                            type="time"
                            value={perDay[day]?.start ?? '18:00'}
                            onChange={(e) =>
                              setPerDay((p) => ({
                                ...p,
                                [day]: { start: e.target.value, end: p[day]?.end ?? '20:00' },
                              }))
                            }
                          />
                        </Field>
                      </div>
                      <div className="flex-1">
                        <Field label="Finish">
                          <Input
                            type="time"
                            value={perDay[day]?.end ?? '20:00'}
                            onChange={(e) =>
                              setPerDay((p) => ({
                                ...p,
                                [day]: { start: p[day]?.start ?? '18:00', end: e.target.value },
                              }))
                            }
                          />
                        </Field>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}

            {error && <p className="mt-3 text-[14px] text-card-red">{error}</p>}

            <div className="mt-5 space-y-2">
              <Button size="lg" fullWidth loading={busy} onClick={saveSchedule}>
                Continue
              </Button>
              {selectedDays.length === 0 && (
                <Button variant="ghost" fullWidth onClick={() => setStep(2)}>
                  I'll set this up later
                </Button>
              )}
            </div>
          </FadeIn>
        )}

        {step === 2 && org && (
          <PlayersStep
            org={org}
            addedPlayers={addedPlayers}
            onPlayerAdded={(p) => setAddedPlayers((prev) => [...prev, p])}
            onContinue={saveScoringAndFinish}
            busy={busy}
          />
        )}

        {step === 3 && org && (
          <ReviewStep
            org={org}
            onFinish={() => {
              sessionStorage.removeItem('tb_onboarding_active')
              navigate('/app', { replace: true })
            }}
          />
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Step 3 — Players: manual add + self-serve invite + pending queue           */
/* -------------------------------------------------------------------------- */

const FEET = [
  { value: '', label: 'No preference' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
]

function PlayersStep({
  org,
  addedPlayers,
  onPlayerAdded,
  onContinue,
  busy,
}: {
  org: Organization
  addedPlayers: Player[]
  onPlayerAdded: (p: Player) => void
  onContinue: () => void
  busy: boolean
}) {
  const [form, setForm] = useState({
    first_name: '',
    display_name: '',
    whatsapp_nickname: '',
    preferred_foot: '',
    position: '',
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false);

  const inviteLink = `${window.location.origin}/play/${org.slug}`

  const { data: pending, refetch: refetchPending } = useQuery({
    queryKey: ['players-pending', org.id],
    queryFn: async () => (await api.get<Player[]>('players', { status: 'pending' })).data,
    refetchInterval: 15000,
  })

  async function addPlayer() {
    if (form.first_name.trim().length < 1) return
    setSaving(true)
    setError(null)
    try {
      const photo_base64 = photoFile ? await compressImage(photoFile) : undefined
      const { data } = await api.post<Player>('players', {
        first_name: form.first_name.trim(),
        display_name: form.display_name.trim() || undefined,
        whatsapp_nickname: form.whatsapp_nickname.trim() || undefined,
        preferred_foot: form.preferred_foot || undefined,
        position: form.position || undefined,
        photo_base64,
      })
      onPlayerAdded(data)
      setForm({ first_name: '', display_name: '', whatsapp_nickname: '', preferred_foot: '', position: '' })
      setPhotoFile(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that player')
    } finally {
      setSaving(false)
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    await api.post(`players/${id}/${action}`)
    refetchPending()
  }

  return (
    <FadeIn key="step2players">
      <h1 className="text-3xl">Add your squad</h1>
      <p className="mt-2 mb-7 text-[15px] text-chalk-muted">
        Add players yourself, or share the invite link and let them add themselves — you approve
        each one before they show up in the squad.
      </p>

      <Card className="mb-5 space-y-3">
        <Field label="Name">
          <Input
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            placeholder="Ade Adeyemi"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kit / nickname" hint="Optional">
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
        </div>
        <Field label="Position" hint="Optional">
          <PositionSelect
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
        </Field>
        <Field label="WhatsApp nickname" hint="Optional — the name they go by in the group chat">
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
          fullWidth
          loading={saving}
          disabled={form.first_name.trim().length < 1}
          onClick={addPlayer}
        >
          Add player
        </Button>
      </Card>

      {addedPlayers.length > 0 && (
        <div className="mb-5 space-y-2">
          {addedPlayers.map((p) => (
            <Card key={p.id} className="flex items-center gap-3 py-2.5">
              <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-chalk">{p.display_name}</span>
            </Card>
          ))}
        </div>
      )}

      <Card className="mb-5">
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">Self-serve invite link</div>
        <p className="mt-1 text-[13px] text-chalk-muted">
          Share this and players can add themselves — you'll approve each one below.
        </p>
        <div className="mt-2 truncate rounded-lg bg-pitch-900 px-3 py-2 font-mono text-[13px] text-volt-400">
          {inviteLink}
        </div>
        <Button
          variant="secondary"
          fullWidth
          className="mt-3"
          onClick={() => {
            navigator.clipboard.writeText(inviteLink)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
      </Card>

      {(pending ?? []).length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-medium text-chalk">Waiting for approval</span>
            <Badge tone="warn">{pending!.length}</Badge>
          </div>
          <div className="space-y-2">
            {pending!.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 py-2.5">
                <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-chalk">{p.display_name}</span>
                <button
                  onClick={() => decide(p.id, 'reject')}
                  className="text-[13px] text-chalk-muted hover:text-card-red"
                >
                  Reject
                </button>
                <button
                  onClick={() => decide(p.id, 'approve')}
                  className="text-[13px] font-medium text-volt-400"
                >
                  Approve
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Button size="lg" fullWidth loading={busy} onClick={onContinue}>
        Continue
      </Button>
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */
/* Step 4 — Review: schedule + squad + next-session preview                   */
/* -------------------------------------------------------------------------- */

function ReviewStep({ org, onFinish }: { org: Organization; onFinish: () => void }) {
  const queryClient = useQueryClient()

  const { data: upcoming } = useQuery({
    queryKey: ['upcoming-slots', org.id],
    queryFn: async () => (await api.get<UpcomingSlot[]>(`organizations/${org.id}/slots/upcoming`, { limit: 1 })).data,
  })

  const { data: players } = useQuery({
    queryKey: ['players', org.id],
    queryFn: async () => (await api.get<Player[]>('players')).data,
  })

  const next = upcoming?.[0]

  return (
    <FadeIn key="step3review">
      <div className="mb-6 text-center">
        <div className="mb-4 text-6xl">🏆</div>
        <h1 className="text-3xl">{org.name} is ready</h1>
        <p className="mt-2 text-[15px] text-chalk-muted">
          Nothing else to set up — sessions will appear on your own from your schedule.
        </p>
      </div>

      <Card className="mb-3">
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">Next session</div>
        {next ? (
          <>
            <div className="mt-1 text-[17px] text-chalk">{next.display_label}</div>
            <div className="mt-0.5 text-[13px] text-volt-400">{countdown(next.occurs_at)}</div>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-chalk-muted">
            No schedule set yet — add one any time in Settings → Schedule.
          </p>
        )}
      </Card>

      <Card className="mb-5">
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">Squad</div>
        <div className="mt-1 text-[17px] text-chalk">
          {(players ?? []).length} player{(players ?? []).length === 1 ? '' : 's'} ready
        </div>
      </Card>

      <Card className="mb-5">
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">Your share link</div>
        <div className="mt-1.5 truncate font-mono text-[13px] text-volt-400">
          {window.location.origin}/t/{org.slug}
        </div>
        <Button
          variant="secondary"
          fullWidth
          className="mt-3"
          onClick={() => navigator.clipboard.writeText(`${window.location.origin}/t/${org.slug}`)}
        >
          Copy link
        </Button>
      </Card>

      <Button
        size="lg"
        fullWidth
        onClick={() => {
          queryClient.invalidateQueries()
          onFinish()
        }}
      >
        Go to my dashboard
      </Button>
    </FadeIn>
  )
}
