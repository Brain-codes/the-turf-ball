import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  RiAddLine, RiAlarmWarningLine, RiArrowRightSLine, RiCheckboxCircleLine,
  RiSearchLine, RiSettings3Line, RiWallet3Line, RiWhatsappLine,
} from '@remixicon/react'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import { Badge, Button, Card, EmptyState, ErrorState, Input, PlayerAvatar, SectionTitle, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { FinanceEntry, FinanceOverview, FinancePaid, FinancePaidPlayer, FinancePaidWindow, FinancePlayerRow } from '@/types'
import { PLAN_LABEL, formatMoney, needsAttention, reminderText, shortNiceDate, subLine, whatsappLink } from './money'
import { PaymentSheet, RenewSheet, type SheetPlayer } from './sheets'
import { useIsFinanceAdmin } from './hooks'

type Filter = 'all' | 'owing' | 'due' | 'paid' | 'monthly' | 'per_game'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'owing', label: 'Owing' },
  { key: 'due', label: 'Due / ran out' },
  { key: 'paid', label: 'Paid up' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'per_game', label: 'Pay as you play' },
]

export function FinanceScreen() {
  const { activeOrg } = useAuth()
  const isAdmin = useIsFinanceAdmin()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState<FinancePlayerRow | null>(null)
  const [renewing, setRenewing] = useState<FinancePlayerRow | null>(null)

  const overview = useQuery({
    queryKey: ['finance', activeOrg?.id, 'overview'],
    queryFn: async () => (await api.get<FinanceOverview>('finance/overview')).data,
    enabled: !!activeOrg && isAdmin,
  })
  const activity = useQuery({
    queryKey: ['finance', activeOrg?.id, 'activity'],
    queryFn: async () => (await api.get<FinanceEntry[]>('finance/activity', { limit: 8 })).data,
    enabled: !!activeOrg && isAdmin && !!overview.data?.enabled,
  })

  const paid = useQuery({
    queryKey: ['finance', activeOrg?.id, 'paid'],
    queryFn: async () => (await api.get<FinancePaid>('finance/paid')).data,
    enabled: !!activeOrg && isAdmin && !!overview.data?.enabled,
  })

  const data = overview.data
  const currency = data?.settings.currency ?? 'NGN'

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.players ?? [])
      .filter((p) => !q || p.display_name.toLowerCase().includes(q) || p.whatsapp_nickname?.toLowerCase().includes(q))
      .filter((p) => {
        switch (filter) {
          case 'owing': return p.balance > 0
          case 'due': return p.sub_state === 'due_soon' || p.sub_state === 'expired'
          case 'paid': return p.balance <= 0 && p.sub_state !== 'expired' && p.plan !== 'exempt'
          case 'monthly': return p.plan === 'monthly'
          case 'per_game': return p.plan === 'per_game'
          default: return true
        }
      })
      // Whoever owes the most first, then whoever's month is closest to running out.
      .sort((a, b) => b.balance - a.balance || (a.sub_days ?? 999) - (b.sub_days ?? 999) || a.display_name.localeCompare(b.display_name))
  }, [data?.players, filter, search])

  if (!isAdmin) return <Navigate to="/app" replace />

  if (overview.isLoading) {
    return (
      <div className="space-y-4 px-5 pt-6">
        <Skeleton className="h-10 w-40" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (overview.error || !data) return <ErrorState message="We couldn’t load the money screen." onRetry={() => overview.refetch()} />

  if (!data.enabled) return <SwitchedOff />

  const s = data.summary!
  const feesMissing = data.settings.monthly_fee <= 0 && data.settings.game_fee <= 0
  const attention = (data.players ?? []).filter((p) => p.sub_state === 'due_soon' || p.sub_state === 'expired')
  const collectedPct = s.charged_this_month > 0 ? Math.min(100, Math.round((s.collected_this_month / s.charged_this_month) * 100)) : null

  const toSheet = (p: FinancePlayerRow | null): SheetPlayer | null =>
    p && { id: p.player_id, display_name: p.display_name, balance: p.balance, game_fee: p.game_fee, monthly_fee: p.monthly_fee }

  return (
    <div className="pb-10">
      <PageHeader
        title="Money"
        subtitle="Who has paid, who owes, and whose month is running out"
        action={
          <Link to="/app/settings/money" aria-label="Money settings" className="flex h-11 w-11 items-center justify-center rounded-xl border border-pitch-700 bg-pitch-900 text-chalk-muted hover:text-chalk">
            <RiSettings3Line className="h-5 w-5" />
          </Link>
        }
      />

      <div className="space-y-6 px-5">
        {feesMissing && (
          <Card className="flex items-center gap-3 border-card-yellow/40">
            <RiAlarmWarningLine className="h-5 w-5 shrink-0 text-card-yellow" />
            <p className="flex-1 text-[14px]">Set your monthly and game fees so the app knows what to charge.</p>
            <Button size="sm" onClick={() => navigate('/app/settings/money')}>Set fees</Button>
          </Card>
        )}

        {/* Headline numbers */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Owed to the group"
            value={formatMoney(s.outstanding, currency)}
            sub={s.owing_count === 0 ? 'Nobody owes anything' : `${s.owing_count} player${s.owing_count === 1 ? '' : 's'} owing`}
            tone={s.outstanding > 0 ? 'warn' : 'good'}
            onClick={() => setFilter('owing')}
          />
          <Tile
            label="Collected this month"
            value={formatMoney(s.collected_this_month, currency)}
            sub={collectedPct === null ? 'Nothing charged yet' : `${collectedPct}% of ${formatMoney(s.charged_this_month, currency)} charged`}
            progress={collectedPct}
          />
          <Tile
            label="Due soon"
            value={String(s.due_soon_count)}
            sub={`Monthly, within ${data.settings.remind_days_before} day${data.settings.remind_days_before === 1 ? '' : 's'}`}
            tone={s.due_soon_count > 0 ? 'warn' : undefined}
            onClick={() => setFilter('due')}
          />
          <Tile
            label="Month ran out"
            value={String(s.expired_count)}
            sub="Monthly players not renewed"
            tone={s.expired_count > 0 ? 'bad' : undefined}
            onClick={() => setFilter('due')}
          />
        </div>

        {/* Reminders */}
        {attention.length > 0 && (
          <section>
            <SectionTitle>Send a reminder</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {attention.slice(0, 6).map((p) => (
                <Card key={p.player_id} className="flex items-center gap-3">
                  <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] text-chalk">{p.display_name}</div>
                    <div className={cn('text-[13px]', p.sub_state === 'expired' ? 'text-card-red' : 'text-card-yellow')}>
                      {subLine(p.sub_state, p.sub_days, p.sub_ends_on)}
                    </div>
                  </div>
                  <a
                    href={whatsappLink(p.phone, reminderText(p, activeOrg?.name ?? 'the group', currency))}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#25D366]/15 px-3.5 text-[14px] font-medium text-[#25D366] hover:bg-[#25D366]/25"
                  >
                    <RiWhatsappLine className="h-5 w-5" /> Remind
                  </a>
                  <Button size="sm" variant="secondary" className="h-11" onClick={() => setRenewing(p)}>Renew</Button>
                </Card>
              ))}
            </div>
            {attention.length > 6 && (
              <button onClick={() => setFilter('due')} className="mt-2 text-[14px] text-volt-400">See all {attention.length}</button>
            )}
          </section>
        )}

        {/* Who has paid */}
        <PaidLists paid={paid.data} loading={paid.isLoading} currency={currency} />

        {/* Players */}
        <section>
          <SectionTitle>Players</SectionTitle>
          <div className="relative mb-3">
            <RiSearchLine className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-chalk-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players" className="pl-10" />
          </div>
          <div className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  'h-10 shrink-0 cursor-pointer rounded-full border px-4 text-[14px] transition-colors',
                  filter === f.key ? 'border-volt-400 bg-volt-400 font-semibold text-void' : 'border-pitch-700 bg-pitch-900 text-chalk-muted hover:text-chalk',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<RiCheckboxCircleLine className="h-10 w-10" />}
              title={filter === 'owing' ? 'Nobody owes anything' : filter === 'due' ? 'Nobody is due' : 'No players here'}
              description={search ? 'Try a different name.' : undefined}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((p) => (
                <PlayerMoneyCard
                  key={p.player_id}
                  row={p}
                  currency={currency}
                  groupName={activeOrg?.name ?? 'the group'}
                  onPay={() => setPaying(p)}
                  onRenew={() => setRenewing(p)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recent */}
        <section>
          <SectionTitle>Latest activity</SectionTitle>
          {activity.data && activity.data.length > 0 ? (
            <Card className="divide-y divide-pitch-700 p-0">
              {activity.data.map((e) => <ActivityRow key={e.id} entry={e} currency={currency} />)}
            </Card>
          ) : (
            <p className="text-[14px] text-chalk-muted">
              Nothing yet. Game fees appear here when you tick players in at a session, and payments when you record them.
            </p>
          )}
        </section>
      </div>

      <PaymentSheet open={!!paying} onClose={() => setPaying(null)} player={toSheet(paying)} currency={currency} />
      <RenewSheet
        open={!!renewing}
        onClose={() => setRenewing(null)}
        player={toSheet(renewing)}
        currency={currency}
        lastEndsOn={renewing?.sub_ends_on ?? null}
        today={data.today}
      />
    </div>
  )
}

type PaidTab = 'last_week' | 'this_week' | 'month'

const PAID_TABS: { key: PaidTab; label: string }[] = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'month', label: 'This month' },
]

function rangeLabel(w: FinancePaidWindow, tab: PaidTab): string {
  if (tab === 'month') return format(parseISO(w.from), 'MMMM yyyy')
  return `${format(parseISO(w.from), 'd MMM')} – ${format(parseISO(w.to), 'd MMM')}`
}

/** Plain lists of who has paid: this week, last week, this month. */
function PaidLists({ paid, loading, currency }: { paid?: FinancePaid; loading: boolean; currency: string }) {
  const [tab, setTab] = useState<PaidTab>('this_week')
  const win = paid?.[tab]
  const carried = tab === 'this_week' ? paid?.this_week.carried ?? [] : []

  return (
    <section>
      <SectionTitle>Who has paid</SectionTitle>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-pitch-700 bg-pitch-900 p-1" role="tablist">
        {PAID_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'h-10 cursor-pointer rounded-lg text-[14px] transition-colors',
              tab === t.key ? 'bg-volt-400 font-semibold text-void' : 'text-chalk-muted hover:text-chalk',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading || !win ? (
        <Skeleton className="h-40" />
      ) : (
        <Card className="p-0">
          <div className="flex items-baseline justify-between border-b border-pitch-700 px-4 py-3">
            <div>
              <div className="text-[13px] text-chalk-muted">{rangeLabel(win, tab)}</div>
              <div className="text-[13px] text-chalk-muted">{win.players.length} paid</div>
            </div>
            <div className="numeric text-xl text-volt-400">{formatMoney(win.total, currency)}</div>
          </div>
          {win.players.length === 0 && carried.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-chalk-muted">Nobody has paid in this period yet.</p>
          ) : (
            <>
              {win.players.length > 0 && (
                <ul className="divide-y divide-pitch-700">
                  {win.players.map((p) => <PaidRow key={p.player_id} p={p} currency={currency} />)}
                </ul>
              )}
              {carried.length > 0 && (
                <>
                  <div className="border-y border-pitch-700 bg-pitch-800/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-muted">
                    Money carried over, covers this week
                  </div>
                  <ul className="divide-y divide-pitch-700">
                    {carried.map((p) => <PaidRow key={p.player_id} p={p} currency={currency} />)}
                  </ul>
                </>
              )}
            </>
          )}
        </Card>
      )}
    </section>
  )
}

function PaidRow({ p, currency }: { p: FinancePaidPlayer; currency: string }) {
  return (
    <li>
      <Link to={`/app/finance/${p.player_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-pitch-800/60">
        <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
        <span className="min-w-0 flex-1 truncate text-[15px] text-chalk">{p.display_name}</span>
        <span className="numeric text-[15px] text-chalk">{formatMoney(p.amount, currency)}</span>
      </Link>
    </li>
  )
}

function Tile({ label, value, sub, tone, progress, onClick }: {
  label: string
  value: string
  sub: string
  tone?: 'good' | 'warn' | 'bad'
  progress?: number | null
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn('surface block w-full px-4 py-4 text-left', onClick && 'cursor-pointer transition-colors hover:border-pitch-600')}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-muted">{label}</div>
      <div
        className={cn(
          'numeric mt-2 truncate text-2xl leading-none md:text-3xl',
          tone === 'warn' ? 'text-card-yellow' : tone === 'bad' ? 'text-card-red' : tone === 'good' ? 'text-volt-400' : 'text-chalk',
        )}
      >
        {value}
      </div>
      {progress != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-pitch-700" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-volt-400" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mt-2 text-[12.5px] leading-snug text-chalk-muted">{sub}</div>
    </Tag>
  )
}

function PlayerMoneyCard({ row, currency, groupName, onPay, onRenew }: {
  row: FinancePlayerRow
  currency: string
  groupName: string
  onPay: () => void
  onRenew: () => void
}) {
  const owes = row.balance > 0
  const credit = row.balance < 0
  const statusTone =
    row.sub_state === 'expired' ? 'text-card-red' : row.sub_state === 'due_soon' ? 'text-card-yellow' : 'text-chalk-muted'

  return (
    <div className={cn('surface flex flex-col p-0', owes && 'border-card-yellow/30')}>
      <Link to={`/app/finance/${row.player_id}`} className="flex items-center gap-3 rounded-t-2xl px-4 pb-3 pt-4 hover:bg-pitch-800/60">
        <PlayerAvatar name={row.display_name} photoUrl={row.photo_url} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15.5px] text-chalk">{row.display_name}</span>
            {row.player_status === 'guest' && <Badge>One-time</Badge>}
          </div>
          <div className={cn('mt-0.5 truncate text-[13px]', statusTone)}>
            {PLAN_LABEL[row.plan]}
            {row.plan === 'monthly' && ` · ${subLine(row.sub_state, row.sub_days, row.sub_ends_on)}`}
            {row.plan === 'per_game' && ` · ${row.games_this_month} game${row.games_this_month === 1 ? '' : 's'} this month`}
          </div>
        </div>
        <div className="text-right">
          <div className={cn('numeric text-lg leading-none', owes ? 'text-card-yellow' : credit ? 'text-volt-400' : 'text-chalk-muted')}>
            {owes ? formatMoney(row.balance, currency) : credit ? formatMoney(-row.balance, currency) : '—'}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-chalk-faint">{owes ? 'Owes' : credit ? 'In credit' : 'Settled'}</div>
        </div>
        <RiArrowRightSLine className="h-5 w-5 shrink-0 text-chalk-faint" />
      </Link>

      {row.plan !== 'exempt' && (
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-pitch-700 p-3">
          {row.plan === 'monthly' && row.sub_state !== 'active' ? (
            <Button size="md" onClick={onRenew}><RiAddLine className="h-4 w-4" /> Renew month</Button>
          ) : (
            <Button size="md" variant={owes ? 'primary' : 'secondary'} onClick={onPay}>
              <RiWallet3Line className="h-4 w-4" /> Record payment
            </Button>
          )}
          {needsAttention(row) ? (
            <a
              href={whatsappLink(row.phone, reminderText(row, groupName, currency))}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-pitch-700 bg-pitch-800 text-[15px] text-chalk hover:border-pitch-600"
            >
              <RiWhatsappLine className="h-4.5 w-4.5 text-[#25D366]" /> Remind
            </a>
          ) : row.plan === 'monthly' ? (
            <Button size="md" variant="secondary" onClick={onRenew}>Add a month</Button>
          ) : (
            <Button size="md" variant="secondary" onClick={onPay}>Pay ahead</Button>
          )}
        </div>
      )}
    </div>
  )
}

export function ActivityRow({ entry, currency, showPlayer = true }: { entry: FinanceEntry; currency: string; showPlayer?: boolean }) {
  const voided = !!entry.voided_at
  const sign = entry.kind === 'charge' ? '+' : '−'
  const label =
    entry.kind === 'payment'
      ? `Paid${entry.method ? ` · ${entry.method === 'transfer' ? 'Transfer' : entry.method === 'cash' ? 'Cash' : entry.method === 'card' ? 'Card' : 'Other'}` : ''}`
      : entry.kind === 'credit'
        ? 'Taken off'
        : entry.source === 'game'
          ? 'Game fee'
          : entry.source === 'subscription'
            ? 'Monthly'
            : 'Charge'
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', voided && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] text-chalk">
          {showPlayer && entry.players?.display_name ? `${entry.players.display_name} · ` : ''}
          {label}
        </div>
        <div className="truncate text-[12.5px] text-chalk-muted">
          {shortNiceDate(entry.entry_date)}
          {entry.description && entry.source === 'manual' ? ` · ${entry.description}` : ''}
          {voided && ` · Cancelled: ${entry.void_reason}`}
        </div>
      </div>
      <div
        className={cn(
          'numeric text-[15px]',
          voided ? 'text-chalk-faint line-through' : entry.kind === 'charge' ? 'text-chalk' : 'text-volt-400',
        )}
        aria-label={`${entry.kind === 'charge' ? 'Owed' : 'Reduces what they owe by'} ${formatMoney(entry.amount, currency)}`}
      >
        {sign}{formatMoney(entry.amount, currency)}
      </div>
    </div>
  )
}

function SwitchedOff() {
  const navigate = useNavigate()
  const points = [
    ['Monthly or pay as you play', 'Each player can be on either, and switch whenever they like.'],
    ['Game fees add themselves', 'Tick someone in at a session and their fee is added. Monthly players who are paid up aren’t charged.'],
    ['Reminders on WhatsApp', 'See whose month runs out soon and send a ready-written reminder in one tap.'],
    ['Only admins see it', 'Nothing about money ever shows on your public page or to recorders.'],
  ]
  return (
    <div className="pb-10">
      <PageHeader title="Money" />
      <div className="px-5">
        <EmptyState
          icon={<RiWallet3Line className="h-12 w-12 text-volt-400" />}
          title="Track subscriptions and pitch fees"
          description="Money is off for this group. Switch it on to keep track of who has paid, who owes, and whose month is running out."
          action={<Button size="lg" onClick={() => navigate('/app/settings/money')}>Set it up</Button>}
        />
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
          {points.map(([title, text]) => (
            <Card key={title}>
              <div className="text-[15px] text-chalk">{title}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-muted">{text}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
