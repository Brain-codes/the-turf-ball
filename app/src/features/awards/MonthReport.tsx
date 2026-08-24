/**
 * The full month, on one screen.
 *
 * This is the app's answer to the long WhatsApp round-up the captain used to
 * type by hand: who turned up, what everyone scored, who won what, which
 * records fell, and the milestones people passed — plus the finished text,
 * ready to paste into the group chat.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/client'
import {
  Button, Card, EmptyState, ErrorState, SectionTitle, Skeleton, StatTile,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { points, shortDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { MonthReport as Report, RankedEntry } from '@/types'

const METRIC_TITLE: Record<string, string> = {
  goals: 'Goals',
  assists: 'Assists',
  contributions: 'Goals + assists',
  clean_sheets: 'Clean sheets',
  appearances: 'Appearances',
  points: 'Points',
}

const RECORD_ORDER = ['goals', 'assists', 'contributions', 'clean_sheets', 'appearances', 'points']

export function MonthReport({ periodId }: { periodId: string }) {
  const [view, setView] = useState<'month' | 'records' | 'alltime'>('month')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['period-report', periodId],
    queryFn: async () => (await api.get<Report>(`periods/${periodId}/report`)).data,
    enabled: !!periodId,
  })

  if (isLoading) return <Skeleton className="h-72" />
  if (error) return <ErrorState message={(error as Error).message} onRetry={refetch} />
  if (!data) return null

  if (data.attendance.session_count === 0 && data.totals.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="Nothing to report yet"
        description={`Once ${data.period.label} has a session with people in it, the full breakdown appears here.`}
      />
    )
  }

  return (
    <FadeIn>
      {data.provisional && (
        <div className="mb-4 rounded-xl border border-card-yellow/30 bg-card-yellow/5 p-3.5">
          <p className="text-[13.5px] leading-relaxed text-chalk">
            {data.period.label} is still open, so these are the numbers so far. They are locked in
            for good when the month closes.
          </p>
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <ViewTab active={view === 'month'} onClick={() => setView('month')}>This month</ViewTab>
        <ViewTab active={view === 'records'} onClick={() => setView('records')}>Records</ViewTab>
        <ViewTab active={view === 'alltime'} onClick={() => setView('alltime')}>All time</ViewTab>
      </div>

      {view === 'month' && <ThisMonth report={data} />}
      {view === 'records' && <Records report={data} />}
      {view === 'alltime' && <AllTime report={data} />}
    </FadeIn>
  )
}

/* -------------------------------------------------------------------------- */
/* This month                                                                  */
/* -------------------------------------------------------------------------- */

function ThisMonth({ report }: { report: Report }) {
  const perfect = report.perfect_attendance
  return (
    <div className="space-y-7">
      <section>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label="Sessions" value={report.attendance.session_count} />
          <StatTile label="Avg turnout" value={report.attendance.average} accent />
          <StatTile label="Goals" value={report.summary.goals} />
          <StatTile label="Assists" value={report.summary.assists} />
        </div>
        <p className="mt-2.5 px-1 text-[13px] leading-relaxed text-chalk-muted">
          {report.attendance.session_count > 0 ? (
            <>
              Out of {report.squad_size} registered {report.squad_size === 1 ? 'member' : 'members'},{' '}
              an average of {report.attendance.average} turned up across{' '}
              {report.attendance.session_count}{' '}
              {report.attendance.session_count === 1 ? 'session' : 'sessions'}.
              {perfect.length > 0 && (
                <> {perfect.length} {perfect.length === 1 ? 'member' : 'members'} made every one.</>
              )}
            </>
          ) : (
            <>No sessions were played this month.</>
          )}
        </p>
      </section>

      {report.attendance.sessions.length > 0 && (
        <section>
          <SectionTitle>Attendance</SectionTitle>
          <Card className="divide-y divide-pitch-700/60 p-0">
            {report.attendance.sessions.map((s) => (
              <div key={s.session_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-chalk">{shortDate(s.date)}</span>
                  {s.title && (
                    <span className="block truncate text-[12.5px] text-chalk-muted">{s.title}</span>
                  )}
                </span>
                <span className="numeric text-[15px] text-chalk-muted">
                  {s.attendees} <span className="text-[11px] uppercase tracking-wider">in</span>
                </span>
              </div>
            ))}
          </Card>
          {perfect.length > 0 && (
            <p className="mt-2 px-1 text-[13px] leading-relaxed text-chalk-muted">
              <span className="text-volt-400">Ever-present:</span>{' '}
              {perfect.map((p) => p.player).join(', ')}
            </p>
          )}
        </section>
      )}

      {report.awards.length > 0 && (
        <section>
          <SectionTitle>Awards</SectionTitle>
          <div className="space-y-2">
            {report.awards.map((a) => (
              <Card key={a.code} className="flex items-center gap-3">
                <span className="text-2xl">{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-chalk">{a.name}</span>
                  <span className="block text-[13px] text-chalk-muted">{a.player}</span>
                </span>
                <span className="numeric text-xl text-volt-400">{points(a.value)}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Everyone's month</SectionTitle>
        <StatsTable
          rows={report.totals.map((t) => ({
            key: t.player_id,
            name: t.player,
            cells: [t.goals, t.assists, t.clean_sheets, t.appearances, points(t.points)],
          }))}
          headers={['G', 'A', 'CS', 'Apps', 'Pts']}
        />
      </section>

      <ShareCard report={report} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

function Records({ report }: { report: Report }) {
  const nothing =
    report.records.length === 0 && report.milestones.length === 0 && report.doubles.length === 0

  return (
    <div className="space-y-7">
      <section>
        <SectionTitle>Set this month</SectionTitle>
        {nothing ? (
          <Card>
            <p className="text-[14px] leading-relaxed text-chalk-muted">
              No records broken this month — the ones already on the board held.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {report.headlines.map((line, i) => (
              <Card key={i} className="flex gap-3">
                <span className="text-[17px] leading-none">🔥</span>
                <p className="text-[14.5px] leading-relaxed text-chalk">{line}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {report.potm_history.length > 0 && (
        <section>
          <SectionTitle>Player of the Month, every month</SectionTitle>
          <Card className="divide-y divide-pitch-700/60 p-0">
            {[...report.potm_history].reverse().map((p) => (
              <div key={`${p.year}-${p.month_number}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[15px]">🏆</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-chalk">{p.player}</span>
                  <span className="block text-[12.5px] text-chalk-muted">{p.month}</span>
                </span>
                <span className="numeric text-[15px] text-volt-400">{points(p.value)}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {report.nominations.length > 0 && (
        <section>
          <SectionTitle>Most nominated</SectionTitle>
          <p className="-mt-1 mb-2.5 px-1 text-[12.5px] leading-relaxed text-chalk-faint">
            A nomination is a top-three finish in a closed month.
          </p>
          <Card className="divide-y divide-pitch-700/60 p-0">
            {report.nominations.map((n, i) => (
              <div key={n.player_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="numeric w-5 text-[13px] text-chalk-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 text-[14.5px] text-chalk">{n.player}</span>
                <span className="numeric text-[15px] text-chalk-muted">{n.nominations}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {RECORD_ORDER.filter((m) => (report.month_records[m]?.length ?? 0) > 0).map((metric) => (
        <section key={metric}>
          <SectionTitle>{METRIC_TITLE[metric]} in a single month</SectionTitle>
          <RankedList entries={report.month_records[metric]} showMonth />
        </section>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* All time                                                                    */
/* -------------------------------------------------------------------------- */

function AllTime({ report }: { report: Report }) {
  const top = report.alltime.top ?? {}
  return (
    <div className="space-y-7">
      {RECORD_ORDER.filter((m) => (top[m]?.length ?? 0) > 0).map((metric) => (
        <section key={metric}>
          <SectionTitle>{METRIC_TITLE[metric]} — all time</SectionTitle>
          <RankedList entries={top[metric]} showPerGame={metric !== 'appearances'} />
        </section>
      ))}

      <section>
        <SectionTitle>Every member, since the beginning</SectionTitle>
        <StatsTable
          headers={['G', 'A', 'G/A', 'Apps']}
          rows={report.alltime.table.map((t) => ({
            key: t.player_id,
            name: t.player,
            cells: [t.goals, t.assists, t.contributions, t.appearances],
          }))}
        />
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

function RankedList({
  entries,
  showMonth,
  showPerGame,
}: {
  entries: RankedEntry[]
  showMonth?: boolean
  showPerGame?: boolean
}) {
  return (
    <Card className="divide-y divide-pitch-700/60 p-0">
      {entries.map((e, i) => (
        <div key={`${e.player_id}-${e.month ?? i}`} className="flex items-center gap-3 px-4 py-2.5">
          <span className="numeric w-5 text-[13px] text-chalk-faint">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] text-chalk">{e.player}</span>
            <span className="block text-[12.5px] text-chalk-muted">
              {showMonth && e.month ? `${e.month} · ` : ''}
              {e.appearances} {e.appearances === 1 ? 'app' : 'apps'}
              {showPerGame && e.per_game ? ` · ${e.per_game} a game` : ''}
            </span>
          </span>
          <span className="numeric text-[17px] text-volt-400">{points(e.value)}</span>
        </div>
      ))}
    </Card>
  )
}

function StatsTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: { key: string; name: string; cells: (string | number)[] }[]
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-[14px] text-chalk-muted">Nobody has played yet.</p>
      </Card>
    )
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[320px] text-[14px]">
        <thead>
          <tr className="border-b border-pitch-700/60 text-[11px] uppercase tracking-wider text-chalk-faint">
            <th className="px-4 py-2 text-left font-medium">Player</th>
            {headers.map((h) => (
              <th key={h} className="px-2 py-2 text-right font-medium last:pr-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-pitch-700/40">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-[130px] truncate px-4 py-2 text-chalk">{r.name}</td>
              {r.cells.map((c, i) => (
                <td key={i} className="numeric px-2 py-2 text-right text-chalk-muted last:pr-4">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-full px-3 py-1.5 text-[13.5px] font-medium transition-colors',
        active ? 'bg-volt-400 text-void' : 'border border-pitch-700 text-chalk-muted hover:text-chalk',
      )}
    >
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* The WhatsApp message                                                        */
/* -------------------------------------------------------------------------- */

function ShareCard({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => chatMessage(report), [report])

  return (
    <Card>
      <h3 className="text-[16px]">Send it to the group</h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-muted">
        The whole month written out, ready to paste into WhatsApp.
      </p>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-pitch-800/70 p-3 text-[13px] leading-relaxed text-chalk">
        {text}
      </pre>
      <Button
        className="mt-3"
        fullWidth
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? 'Copied' : 'Copy the message'}
      </Button>
      {report.provisional && (
        <p className="mt-2 text-center text-[12.5px] text-chalk-faint">
          Numbers can still change until the month closes.
        </p>
      )}
    </Card>
  )
}

/** The round-up, in the shape the group already reads it in. */
function chatMessage(report: Report): string {
  const lines: string[] = []
  const month = report.period.label.toUpperCase()

  lines.push(`*${month} — HOW IT WENT*`, '')

  if (report.attendance.session_count > 0) {
    lines.push(
      `${report.attendance.session_count} ${report.attendance.session_count === 1 ? 'session' : 'sessions'}, ` +
        `${report.attendance.average} turning up on average out of ${report.squad_size} registered.`,
    )
    if (report.perfect_attendance.length > 0) {
      lines.push(
        `Ever-present: ${report.perfect_attendance.map((p) => p.player).join(', ')}.`,
      )
    }
    lines.push('')
  }

  const potm = report.awards.find((a) => a.code === 'player_of_month')
  if (potm) {
    lines.push(`🏆 *Player of the Month: ${potm.player}* — ${points(potm.value)} points`)
  }
  const others = report.awards.filter((a) => a.code !== 'player_of_month')
  for (const a of others) lines.push(`${a.icon ?? '•'} ${a.name}: ${a.player} (${points(a.value)})`)
  if (report.awards.length > 0) lines.push('')

  if (report.headlines.length > 0) {
    lines.push(`*RECORDS SET IN ${month.split(' ')[0]}*`, '')
    for (const h of report.headlines) lines.push(`@ ${h}`)
    lines.push('')
  }

  if (report.totals.length > 0) {
    lines.push('*GOALS / ASSISTS / APPS*', '')
    for (const t of report.totals) {
      lines.push(`${t.player} — ${t.goals}G ${t.assists}A ${t.appearances} apps`)
    }
  }

  return lines.join('\n')
}
