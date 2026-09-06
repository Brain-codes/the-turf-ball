import { useEffect, useState, type SVGProps } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { RiArrowDownSLine } from '@remixicon/react'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, Field, Input, SectionTitle,
  Select, Skeleton, Toggle,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { Competition, DeleteAccountPreview, MemberRow, Organization, OrgSettings, ScoringPreset, ScoringRule } from '@/types'

function IconGroup(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 20.5v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 19v1.5" />
      <circle cx="9.5" cy="8" r="3.25" />
      <path d="M15.5 15.5a3 3 0 0 0 3-3v-.25a3 3 0 0 0-2-2.83" />
    </svg>
  )
}
function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" />
    </svg>
  )
}
function IconBall(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 8.2 15.2 10.5l-1.2 3.75H9.9l-1.2-3.75L12 8.2Z" />
      <path d="M12 8.2V4.5M15.2 10.5l3.4-1.1M13.9 14.25l2.1 3M8 14.25l-2.1 3M8.8 10.5 5.4 9.4" />
    </svg>
  )
}
function IconStar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.97 5.68L12 16.4l-5.1 2.68.98-5.68-4.13-4.02 5.7-.83L12 3.5Z" />
    </svg>
  )
}
function IconTrophy(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 4.5h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5v-4Z" />
      <path d="M7 5.5H4.5a2 2 0 0 0 2 2H7M17 5.5h2.5a2 2 0 0 1-2 2H17M12 13.5v3M9 20h6M9.5 20v-2.5a2.5 2.5 0 0 1 5 0V20" />
    </svg>
  )
}
function IconShare(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="18" cy="5.5" r="2.25" />
      <circle cx="6" cy="12" r="2.25" />
      <circle cx="18" cy="18.5" r="2.25" />
      <path d="m8 10.8 8-4.4M8 13.2l8 4.4" />
    </svg>
  )
}
function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.75 19.5c.5-3 2.9-5 5.75-5s5.25 2 5.75 5" />
      <path d="M15.5 6.2a2.75 2.75 0 0 1 0 5.35M17.5 14.75c2.4.35 4.15 2.1 4.75 4.75" />
    </svg>
  )
}
function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.75 19.5c.75-3.75 3.5-6 7.25-6s6.5 2.25 7.25 6" />
    </svg>
  )
}

const TABS = [
  { to: '/app/settings/general', label: 'Group', hint: 'Name, venue, description', icon: IconGroup },
  { to: '/app/settings/schedule', label: 'Schedule', hint: 'Sessions & recurrence', icon: IconCalendar },
  { to: '/app/settings/football', label: 'Football', hint: 'Rules & tracking', icon: IconBall },
  { to: '/app/settings/scoring', label: 'Points', hint: 'Scoring & presets', icon: IconStar },
  { to: '/app/settings/competitions', label: 'Competitions', hint: 'What counts to stats', icon: IconTrophy },
  { to: '/app/settings/share', label: 'Share page', hint: 'Public link & visibility', icon: IconShare },
  { to: '/app/settings/members', label: 'People', hint: 'Invites & access', icon: IconUsers },
  { to: '/app/settings/account', label: 'Account', hint: 'Your login', icon: IconUser },
]

export function SettingsLayout() {
  const { signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const currentTab = TABS.find((t) => location.pathname.startsWith(t.to)) ?? TABS[0]

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

      {/* Mobile: current section picker — a scrolling pill row hides options
          off-screen with no affordance, so this surfaces all 8 sections in
          one dropdown instead. */}
      <div className="mb-5 px-5 md:hidden">
        <label className="relative block">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-volt-400">
            <currentTab.icon className="h-[18px] w-[18px]" />
          </span>
          <select
            value={currentTab.to}
            onChange={(e) => navigate(e.target.value)}
            className="h-12 w-full appearance-none rounded-xl border border-pitch-700 bg-pitch-900 pl-11 pr-10 text-[15px] font-semibold text-chalk focus:border-turf-400 focus:outline-none"
          >
            {TABS.map((tab) => (
              <option key={tab.to} value={tab.to}>{tab.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-chalk-faint">
            <RiArrowDownSLine className="h-5 w-5" />
          </span>
        </label>
      </div>

      {/* Desktop: settings sub-nav + content panel */}
      <div className="px-5 md:grid md:grid-cols-[236px_minmax(0,1fr)] md:items-start md:gap-8">
        <nav className="hidden md:sticky md:top-6 md:block md:space-y-0.5">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition-colors',
                  isActive
                    ? 'bg-pitch-800 font-semibold text-chalk'
                    : 'text-chalk-muted hover:bg-pitch-800/60 hover:text-chalk',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-colors',
                      isActive ? 'text-volt-400' : 'text-chalk-faint group-hover:text-chalk-muted',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{tab.label}</span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 md:pt-1">
          <Outlet />
        </div>
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
          <Field
            label="Who gets credited?"
            hint="This only decides who is credited automatically at full time. Anyone on the pitch can be given a clean sheet by hand while the session is live — in 5-a-side the keeper changes."
          >
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
            label="Penalty saves"
            description="Anyone who goes in goal can be credited with one"
            checked={settings.track_penalty_saves}
            onChange={(v) => update('track_penalty_saves', v)}
          />
          <Toggle
            label="Guests on the table"
            description="Include one-off players in the league table"
            checked={settings.guests_on_leaderboard}
            onChange={(v) => update('guests_on_leaderboard', v)}
          />
        </Card>
      </div>

      <div>
        <SectionTitle>Closing the month</SectionTitle>
        <Card className="divide-y divide-pitch-700 py-0">
          <Toggle
            label="Close months automatically"
            description="The month locks itself and crowns a winner once it's over"
            checked={settings.auto_close_months}
            onChange={(v) => update('auto_close_months', v)}
          />
        </Card>
        {settings.auto_close_months && (
          <Card className="mt-3 space-y-3">
            <Field
              label="Days to wait after the month ends"
              hint="Time to key in anything recorded on paper. 1 means the month closes on the 2nd."
            >
              <Input
                type="number"
                min={0}
                max={14}
                value={settings.auto_close_grace_days}
                onChange={(e) => update('auto_close_grace_days', Number(e.target.value))}
              />
            </Field>
            <p className="text-[13px] leading-relaxed text-chalk-muted">
              An unfinished session holds the month open — finish it and the month closes on the
              next check.
            </p>
          </Card>
        )}
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

export function CompetitionSettings() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()

  const { data: competitions, isLoading } = useQuery({
    queryKey: ['competitions', activeOrg?.id, 'all'],
    queryFn: async () => (await api.get<Competition[]>('competitions')).data,
    enabled: !!activeOrg,
  })

  const toggle = useMutation({
    mutationFn: async ({ id, count_toward_stats }: { id: string; count_toward_stats: boolean }) =>
      api.patch(`competitions/${id}/stats-toggle`, { count_toward_stats }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['competitions'] }),
  })

  if (isLoading) return <Skeleton className="h-48" />

  const list = competitions ?? []

  return (
    <FadeIn className="space-y-6">
      <div>
        <SectionTitle>Count towards the table</SectionTitle>
        <Card className="mb-3">
          <p className="text-[13px] leading-relaxed text-chalk-muted">
            Goals and assists from a competition count towards a player's normal totals by
            default. Nothing is ever deleted — turning a competition off here just leaves it out
            of the sums, and turning it back on brings the numbers straight back.
          </p>
        </Card>
        {list.length === 0 ? (
          <Card>
            <p className="text-[13px] text-chalk-muted">No competitions yet.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-pitch-700 py-0">
            {list.map((c) => (
              <Toggle
                key={c.id}
                label={c.name}
                description={c.status === 'completed' ? 'Completed' : c.status === 'live' ? 'Live now' : 'Upcoming'}
                checked={c.count_toward_stats}
                onChange={(v) => toggle.mutate({ id: c.id, count_toward_stats: v })}
              />
            ))}
          </Card>
        )}
      </div>
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
    penalty_save: 'Saving a penalty',
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

  // Separate from the share-page toggle above: this controls whether the team
  // appears in the cross-team global leaderboard at /leaderboard, not whether
  // their own /t/:slug page is reachable.
  const saveOrg = useMutation({
    mutationFn: async (patch: object) => api.patch(`organizations/${activeOrg!.id}`, patch),
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

      <div>
        <SectionTitle>The Turf Ball table</SectionTitle>
        <Card className="py-0">
          <Toggle
            label="List my team publicly"
            description="Show up in the global players and teams table at /leaderboard"
            checked={org.is_public}
            onChange={(v) => saveOrg.mutate({ is_public: v })}
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

/* -------------------------------------------------------------------------- */

export function AccountSettings() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<'idle' | 'preview' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const preview = useMutation({
    mutationFn: async () => (await api.get<DeleteAccountPreview>('auth/delete-account')).data,
    onSuccess: () => setStep('preview'),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not load account details'),
  })

  const confirmDelete = useMutation({
    mutationFn: async () => api.post('auth/delete-account', { confirm: true }),
    onSuccess: async () => {
      setStep('done')
      setTimeout(async () => {
        await signOut()
        navigate('/', { replace: true })
      }, 3000)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not delete your account'),
  })

  return (
    <FadeIn className="space-y-6">
      <Card>
        <p className="text-[13.5px] leading-relaxed text-chalk-muted">
          Signed in as <b className="text-chalk">{profile?.email}</b>.
        </p>
      </Card>

      <div>
        <SectionTitle>Danger zone</SectionTitle>
        <Card className="border-card-red/30 bg-card-red/5">
          {step === 'done' ? (
            <p className="text-[14px] text-chalk">
              Your account will be permanently deleted in 30 days. Log back in any time before then
              to undo this. Signing you out now…
            </p>
          ) : step === 'preview' ? (
            <div className="space-y-3">
              <p className="text-[14px] leading-relaxed text-chalk">
                {preview.data?.warning}
              </p>
              {(preview.data?.organizations ?? []).length > 0 && (
                <div className="space-y-2">
                  {preview.data!.organizations.map((org) => (
                    <div key={org.id} className="rounded-lg border border-pitch-700 bg-pitch-900 p-3">
                      <div className="text-[14px] font-semibold text-chalk">{org.name}</div>
                      <div className="mt-1 text-[13px] text-chalk-muted">
                        {org.player_count} player(s) · {org.session_count} session(s) ·{' '}
                        {org.other_member_count} other member(s) will lose access
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {error && <p className="text-[14px] text-card-red">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  fullWidth
                  loading={confirmDelete.isPending}
                  onClick={() => { setError(null); confirmDelete.mutate() }}
                >
                  Yes, delete my account
                </Button>
                <Button variant="ghost" fullWidth onClick={() => setStep('idle')}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[14px] leading-relaxed text-chalk-muted">
                Deleting your account removes your access and, if you own any groups, deletes those
                too — with a 30-day grace period. Log back in any time before then to undo it.
              </p>
              {error && <p className="text-[14px] text-card-red">{error}</p>}
              <Button
                variant="danger"
                fullWidth
                loading={preview.isPending}
                onClick={() => { setError(null); preview.mutate() }}
              >
                Delete my account
              </Button>
            </div>
          )}
        </Card>
      </div>
    </FadeIn>
  )
}
