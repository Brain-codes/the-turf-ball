/**
 * Onboarding. SPEC.md §5.1 — must be completable in under two minutes.
 *
 * That constraint drives every decision here: four steps, one question per
 * screen where possible, sensible defaults for everything, and the ability to
 * skip straight past the squad and come back later.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, setActiveOrg } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button, Field, Input, Select, Card } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import type { Organization, ScoringPreset } from '@/types'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const PRESETS: ScoringPreset[] = [
  {
    key: 'balanced',
    name: 'Balanced',
    description: 'Rewards turning up and contributing, not just scoring.',
    rules: { goal: 5, assist: 3, appearance: 1, clean_sheet: 2 },
  },
  {
    key: 'goal_heavy',
    name: 'Goals decide it',
    description: 'For groups where finishing is everything.',
    rules: { goal: 8, assist: 3, appearance: 1, clean_sheet: 2 },
  },
  {
    key: 'team_first',
    name: 'Team first',
    description: 'Turning up and defending count as much as scoring.',
    rules: { goal: 4, assist: 4, appearance: 3, clean_sheet: 4 },
  },
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
    playing_day: 'Sunday',
    default_kickoff: '17:00',
  })

  const [namesText, setNamesText] = useState('')
  const [preset, setPreset] = useState('balanced')

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
        playing_days: [details.playing_day],
        default_kickoff: details.default_kickoff,
      })
      setOrg(data)
      setActiveOrg(data.id)
      await refresh()
      setStep(1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your group')
    } finally {
      setBusy(false)
    }
  }

  async function addPlayers() {
    const names = namesText
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)

    if (names.length === 0) {
      setStep(2)
      return
    }

    setBusy(true)
    setError(null)
    try {
      await api.post('players/bulk', { names })
      setStep(2)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add those players')
    } finally {
      setBusy(false)
    }
  }

  async function saveScoring() {
    setBusy(true)
    setError(null)
    try {
      await api.put('scoring/rules', { preset })
      setStep(3)
    } catch {
      // Scoring already has sensible defaults, so a failure here should not
      // block someone from finishing setup. They can change it in settings.
      setStep(3)
    } finally {
      setBusy(false)
    }
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

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

              <div className="grid grid-cols-2 gap-3">
                <Field label="Which day?">
                  <Select
                    value={details.playing_day}
                    onChange={(e) => setDetails({ ...details, playing_day: e.target.value })}
                  >
                    {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
                <Field label="Kick off">
                  <Input
                    type="time"
                    value={details.default_kickoff}
                    onChange={(e) => setDetails({ ...details, default_kickoff: e.target.value })}
                  />
                </Field>
              </div>

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
          <FadeIn key="step1">
            <h1 className="text-3xl">Add your squad</h1>
            <p className="mt-2 mb-7 text-[15px] text-chalk-muted">
              One name per line. You can add shirt numbers and photos later.
            </p>

            <textarea
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              rows={9}
              autoFocus
              placeholder={'Ade\nMike\nJohn\nSam\nTony'}
              className="w-full resize-none rounded-xl border border-pitch-700 bg-pitch-900 p-4 text-[15px] leading-8 text-chalk placeholder:text-chalk-faint focus:border-turf-400 focus:outline-none"
            />

            <p className="mt-2 text-[13px] text-chalk-faint">
              {namesText.split('\n').filter((n) => n.trim()).length} player(s)
            </p>

            {error && <p className="mt-3 text-[14px] text-card-red">{error}</p>}

            <div className="mt-5 space-y-2">
              <Button size="lg" fullWidth loading={busy} onClick={addPlayers}>
                {namesText.trim() ? 'Add these players' : 'Continue'}
              </Button>
              <Button variant="ghost" fullWidth onClick={() => setStep(2)}>
                I'll do this later
              </Button>
            </div>
          </FadeIn>
        )}

        {step === 2 && (
          <FadeIn key="step2">
            <h1 className="text-3xl">How do points work?</h1>
            <p className="mt-2 mb-7 text-[15px] text-chalk-muted">
              This decides who wins Player of the Month. You can change it any time.
            </p>

            <div className="space-y-3">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    preset === p.key
                      ? 'border-volt-400 bg-volt-400/5'
                      : 'border-pitch-700 bg-pitch-900 hover:border-pitch-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-chalk">{p.name}</span>
                    {preset === p.key && <span className="text-volt-400">✓</span>}
                  </div>
                  <p className="mt-1 text-[13.5px] text-chalk-muted">{p.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(p.rules).map(([key, value]) => (
                      <span
                        key={key}
                        className="rounded-full bg-pitch-800 px-2.5 py-1 text-[11px] text-chalk-muted"
                      >
                        {key.replace('_', ' ')} <span className="numeric text-chalk">+{value}</span>
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <Button size="lg" fullWidth className="mt-5" loading={busy} onClick={saveScoring}>
              Continue
            </Button>
          </FadeIn>
        )}

        {step === 3 && (
          <FadeIn key="step3">
            <div className="mb-6 text-center">
              <div className="mb-4 text-6xl">🏆</div>
              <h1 className="text-3xl">{org?.name} is ready</h1>
              <p className="mt-2 text-[15px] text-chalk-muted">
                Here's your share link — drop it in your WhatsApp group so everyone can follow the table.
              </p>
            </div>

            <Card className="mb-5">
              <div className="text-[11px] uppercase tracking-wider text-chalk-muted">Your share link</div>
              <div className="mt-1.5 truncate font-mono text-[13px] text-volt-400">
                {window.location.origin}/t/{org?.slug}
              </div>
              <Button
                variant="secondary"
                fullWidth
                className="mt-3"
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/t/${org?.slug}`)}
              >
                Copy link
              </Button>
            </Card>

            <Button size="lg" fullWidth onClick={() => navigate('/app', { replace: true })}>
              Go to my dashboard
            </Button>
          </FadeIn>
        )}
      </div>
    </div>
  )
}
