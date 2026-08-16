import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, Field, Input, SectionTitle,
  Select, Skeleton, Toggle,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { MemberRow, Organization, OrgSettings, ScoringPreset, ScoringRule } from '@/types'

const TABS = [
  { to: '/app/settings/general', label: 'Group' },
  { to: '/app/settings/schedule', label: 'Schedule' },
  { to: '/app/settings/football', label: 'Football' },
  { to: '/app/settings/scoring', label: 'Points' },
  { to: '/app/settings/share', label: 'Share page' },
  { to: '/app/settings/members', label: 'People' },
]

export function SettingsLayout() {
  const { signOut } = useAuth()

  return (
    <div className="pb-8">
      <PageHeader
        title="Settings"
        action={
          <Button variant="ghost" size="sm" onClick={signOut} className="md:hidden">
            Sign out
          </Button>
        }
      />

      <div className="mb-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors',
                isActive
                  ? 'bg-volt-400 font-semibold text-void'
                  : 'bg-pitch-800 text-chalk-muted hover:text-chalk',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <div className="px-5">
        <Outlet />
      </div>
    </div>
  )
}

function useOrganization() {
  const { activeOrg } = useAuth()
  return useQuery({
    queryKey: ['organization', activeOrg?.id],
    queryFn: async () => (await api.get<Organization>(`organizations/${activeOrg!.id}`)).data,
    enabled: !!activeOrg,
  })
}

/* -------------------------------------------------------------------------- */

export function GeneralSettings() {
  const { activeOrg, refresh } = useAuth()
  const { data, isLoading } = useOrganization()
  const [form, setForm] = useState({ name: '', short_name: '', venue: '', location: '', description: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name ?? '',
        short_name: data.short_name ?? '',
        venue: data.venue ?? '',
        location: data.location ?? '',
        description: data.description ?? '',
      })
    }
  }, [data])

  const save = useMutation({
    mutationFn: async () => api.patch(`organizations/${activeOrg!.id}`, form),
    onSuccess: async () => {
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  if (isLoading) return <Skeleton className="h-64" />

  return (
    <FadeIn className="space-y-4">
      <Field label="Group name">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Short name" hint="Used where space is tight, e.g. ASB">
        <Input
          value={form.short_name}
          onChange={(e) => setForm({ ...form, short_name: e.target.value })}
          maxLength={12}
        />
      </Field>
      <Field label="Where you play">
        <Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
      </Field>
      <Field label="City or area">
        <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      </Field>
      <Field label="About your group" hint="Shown on your public share page">
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          className="w-full resize-none rounded-lg border border-pitch-700 bg-pitch-900 p-3 text-[15px] text-chalk focus:border-turf-400 focus:outline-none"
        />
      </Field>
      <Button size="lg" fullWidth loading={save.isPending} onClick={() => save.mutate()}>
        {saved ? 'Saved ✓' : 'Save changes'}
      </Button>
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */

export function FootballSettings() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<OrgSettings | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['org-settings', activeOrg?.id],
    queryFn: async () => (await api.get<OrgSettings>(`organizations/${activeOrg!.id}/settings`)).data,
    enabled: !!activeOrg,
  })

  useEffect(() => { if (data) setSettings(data) }, [data])

  const save = useMutation({
    mutationFn: async (patch: Partial<OrgSettings>) =>
      api.patch(`organizations/${activeOrg!.id}/settings`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org-settings'] }),
  })

  function update<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
    save.mutate({ [key]: value } as Partial<OrgSettings>)
  }

  if (isLoading || !settings) return <Skeleton className="h-64" />

  return (
    <FadeIn className="space-y-6">
      <div>
        <SectionTitle>Clean sheets</SectionTitle>
        <Card>
          <Field label="Who gets credited?" hint="Football groups genuinely disagree on this one.">
            <Select
              value={settings.clean_sheet_policy}
              onChange={(e) => update('clean_sheet_policy', e.target.value as OrgSettings['clean_sheet_policy'])}
            >
              <option value="goalkeeper">Just the goalkeeper</option>
              <option value="whole_side">Everyone on the defending team</option>
              <option value="manual">I'll pick each time</option>
            </Select>
          </Field>
        </Card>
      </div>

      <div>
        <SectionTitle>What you track</SectionTitle>
        <Card className="divide-y divide-pitch-700 py-0">
          <Toggle
            label="Punctuality"
            description="Reward players who arrive on time"
            checked={settings.track_punctuality}
            onChange={(v) => update('track_punctuality', v)}
          />
          <Toggle
            label="Cards"
            description="Yellow and red cards count against points"
            checked={settings.track_cards}
            onChange={(v) => update('track_cards', v)}
          />
          <Toggle
            label="Clean sheets"
            checked={settings.track_clean_sheets}
            onChange={(v) => update('track_clean_sheets', v)}
          />
          <Toggle
            label="Guests on the table"
            description="Include one-off players in the league table"
            checked={settings.guests_on_leaderboard}
            onChange={(v) => update('guests_on_leaderboard', v)}
          />
        </Card>
      </div>

      {settings.track_punctuality && (
        <div>
          <SectionTitle>Punctuality windows</SectionTitle>
          <Card className="space-y-3">
            <p className="text-[13px] leading-relaxed text-chalk-muted">
              Measured against each session's own kick-off time, whichever slot it was booked from.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Early if this many minutes before">
                <Input
                  type="number"
                  value={settings.early_before_mins}
                  onChange={(e) => update('early_before_mins', Number(e.target.value))}
                />
              </Field>
              <Field label="Late after this many minutes">
                <Input
                  type="number"
                  value={settings.on_time_after_mins}
                  onChange={(e) => update('on_time_after_mins', Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>
        </div>
      )}
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */

export function ScoringSettings() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [rules, setRules] = useState<ScoringRule[]>([])
  const [saved, setSaved] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['scoring-rules', activeOrg?.id],
    queryFn: async () => (await api.get<ScoringRule[]>('scoring/rules')).data,
    enabled: !!activeOrg,
  })

  const { data: presets } = useQuery({
    queryKey: ['scoring-presets'],
    queryFn: async () => (await api.get<ScoringPreset[]>('scoring/presets')).data,
    enabled: !!activeOrg,
  })

  useEffect(() => { if (data) setRules(data) }, [data])

  const save = useMutation({
    mutationFn: async (payload: object) => api.put('scoring/rules', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  if (isLoading) return <Skeleton className="h-72" />

  const LABELS: Record<string, string> = {
    appearance: 'Turning up',
    goal: 'Scoring a goal',
    assist: 'Making an assist',
    clean_sheet: 'Keeping a clean sheet',
    own_goal: 'Own goal',
    yellow_card: 'Yellow card',
    red_card: 'Red card',
    punctuality: 'Arriving on time',
    save: 'Save',
    motm: 'Man of the match',
  }

  return (
    <FadeIn className="space-y-6">
      <Card>
        <p className="text-[13.5px] leading-relaxed text-chalk-muted">
          These decide the league table and who wins Player of the Month. Your group, your rules —
          change them any time, and the table recalculates immediately.
        </p>
      </Card>

      <div>
        <SectionTitle>Start from a preset</SectionTitle>
        <div className="space-y-2">
          {(presets ?? []).map((preset) => (
            <button
              key={preset.key}
              onClick={() => save.mutate({ preset: preset.key })}
              className="w-full rounded-xl border border-pitch-700 bg-pitch-900 p-3.5 text-left hover:border-pitch-600"
            >
              <span className="block text-[15px] font-semibold text-chalk">{preset.name}</span>
              <span className="text-[13px] text-chalk-muted">{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>Or set each one yourself</SectionTitle>
        <Card className="divide-y divide-pitch-700 py-0">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1 text-[15px] text-chalk">
                {LABELS[rule.event_type] ?? rule.event_type}
              </span>
              <input
                type="number"
                step="0.5"
                value={rule.points}
                onChange={(e) => {
                  const next = [...rules]
                  next[index] = { ...rule, points: Number(e.target.value) }
                  setRules(next)
                }}
                className="numeric h-10 w-20 rounded-lg border border-pitch-700 bg-pitch-800 px-2 text-center text-[16px] text-chalk focus:border-turf-400 focus:outline-none"
              />
            </div>
          ))}
        </Card>
      </div>

      <Button
        size="lg"
        fullWidth
        loading={save.isPending}
        onClick={() => save.mutate({ rules: rules.map((r) => ({ event_type: r.event_type, points: r.points, enabled: r.enabled })) })}
      >
        {saved ? 'Saved — table updated ✓' : 'Save points'}
      </Button>
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */

export function ShareSettings() {
  const { activeOrg } = useAuth()
  const { data: org, isLoading } = useOrganization()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const save = useMutation({
    mutationFn: async (patch: object) => api.patch(`organizations/${activeOrg!.id}/public-page`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organization'] }),
  })

  if (isLoading || !org?.public_page) return <Skeleton className="h-64" />

  const page = org.public_page
  const url = `${window.location.origin}/t/${page.slug}`

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: org!.name, url })
        return
      } catch {
        /* User dismissed the share sheet — fall through to copying. */
      }
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <FadeIn className="space-y-6">
      <Card>
        <div className="text-[11px] uppercase tracking-wider text-chalk-muted">Your share link</div>
        <div className="mt-1.5 break-all font-mono text-[13px] text-volt-400">{url}</div>
        <div className="mt-3 flex gap-2">
          <Button fullWidth onClick={share}>
            {copied ? 'Copied ✓' : 'Share link'}
          </Button>
          <Button variant="secondary" onClick={() => window.open(url, '_blank')}>
            Preview
          </Button>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-chalk-muted">
          Drop this in your WhatsApp group. Anyone can open it — no account needed.
        </p>
      </Card>

      <div>
        <SectionTitle>What people can see</SectionTitle>
        <Card className="divide-y divide-pitch-700 py-0">
          <Toggle
            label="Page is live"
            description="Turn off to hide the page completely"
            checked={page.is_published}
            onChange={(v) => save.mutate({ is_published: v })}
          />
          <Toggle
            label="Player photos"
            checked={page.show_photos}
            onChange={(v) => save.mutate({ show_photos: v })}
          />
          <Toggle
            label="Cards"
            description="Yellow and red card counts"
            checked={page.show_cards}
            onChange={(v) => save.mutate({ show_cards: v })}
          />
          <Toggle
            label="Punctuality"
            checked={page.show_punctuality}
            onChange={(v) => save.mutate({ show_punctuality: v })}
          />
          <Toggle
            label="Session results"
            checked={page.show_sessions}
            onChange={(v) => save.mutate({ show_sessions: v })}
          />
        </Card>
      </div>

      {page.view_count > 0 && (
        <p className="text-center text-[13px] text-chalk-muted">
          Viewed {page.view_count} time{page.view_count === 1 ? '' : 's'}
        </p>
      )}
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */

export function MembersSettings() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'recorder'>('recorder')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['members', activeOrg?.id],
    queryFn: async () => (await api.get<MemberRow[]>('members')).data,
    enabled: !!activeOrg,
  })

  const invite = useMutation({
    mutationFn: async () => api.post<{ invite_path: string }>('members', { email, role }),
    onSuccess: ({ data }) => {
      setInviteLink(`${window.location.origin}${data.invite_path}`)
      setEmail('')
      queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send that invite'),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`members/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members'] }),
  })

  const isOwner = activeOrg?.role === 'owner'

  return (
    <FadeIn className="space-y-6">
      <Card>
        <p className="text-[13.5px] leading-relaxed text-chalk-muted">
          Invite someone to help record goals on match day. A <b className="text-chalk">recorder</b>{' '}
          can tap in what happens but can't change your points or remove players. An{' '}
          <b className="text-chalk">admin</b> can manage the squad and sessions too.
        </p>
      </Card>

      {isOwner && (
        <div>
          <SectionTitle>Invite someone</SectionTitle>
          <Card className="space-y-3">
            <Field label="Their email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@example.com"
              />
            </Field>
            <Field label="What can they do?">
              <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'recorder')}>
                <option value="recorder">Record match events only</option>
                <option value="admin">Manage squad and sessions</option>
              </Select>
            </Field>
            {error && <p className="text-[14px] text-card-red">{error}</p>}
            <Button
              fullWidth
              loading={invite.isPending}
              disabled={!email.includes('@')}
              onClick={() => { setError(null); invite.mutate() }}
            >
              Create invite link
            </Button>

            {inviteLink && (
              <div className="rounded-xl border border-volt-400/30 bg-volt-400/5 p-3.5">
                <p className="text-[13px] text-chalk-muted">
                  Send them this link — it works for 14 days.
                </p>
                <p className="mt-1.5 break-all font-mono text-[12.5px] text-volt-400">{inviteLink}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigator.clipboard.writeText(inviteLink)}
                >
                  Copy link
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <div>
        <SectionTitle>People with access</SectionTitle>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <Card className="divide-y divide-pitch-700 py-0">
            {(data ?? []).map((member) => (
              <div key={member.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-chalk">
                    {member.profiles?.full_name ?? member.invited_email}
                  </span>
                  <span className="text-[13px] text-chalk-muted">
                    {member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Recorder'}
                  </span>
                </span>
                {member.status === 'invited' && <Badge tone="warn">Pending</Badge>}
                {isOwner && member.role !== 'owner' && (
                  <button
                    onClick={() => remove.mutate(member.id)}
                    className="text-[13px] text-card-red"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */

export function JoinScreen() {
  const navigate = useNavigate()
  const { authenticated, refresh } = useAuth()
  const token = window.location.pathname.split('/join/')[1] ?? ''
  const [error, setError] = useState<string | null>(null)

  const accept = useMutation({
    mutationFn: async () => api.post('auth/accept-invite', { token }),
    onSuccess: async () => {
      await refresh()
      navigate('/app', { replace: true })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That link did not work'),
  })

  useEffect(() => {
    if (authenticated && token) accept.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, token])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <div className="mb-4 text-5xl">⚽</div>
      {!authenticated ? (
        <>
          <h1 className="text-2xl">You've been invited</h1>
          <p className="mt-2 max-w-xs text-[15px] text-chalk-muted">
            Sign in or create an account to join the group.
          </p>
          <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
            <Button size="lg" fullWidth onClick={() => navigate(`/login?redirect=/join/${token}`)}>
              Sign in
            </Button>
            <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('/register')}>
              Create an account
            </Button>
          </div>
        </>
      ) : error ? (
        <>
          <h1 className="text-2xl">That didn't work</h1>
          <p className="mt-2 max-w-xs text-[15px] text-chalk-muted">{error}</p>
          <Button className="mt-6" onClick={() => navigate('/app')}>Go to the app</Button>
        </>
      ) : (
        <p className="text-[15px] text-chalk-muted">Joining the group…</p>
      )}
    </div>
  )
}
