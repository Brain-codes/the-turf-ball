/**
 * One match day, wrapped — the session version of the monthly breakdown.
 *
 * Same idea as MonthReport: what happened, who did it, which records fell,
 * and where tonight sits against every session the club has ever played,
 * finished with the message for the group chat.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/client'
import {
  Button, Card, EmptyState, ErrorState, SectionTitle, Skeleton, StatTile,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { SessionReport as Report } from '@/types'

const METRIC_TITLE: Record<string, string> = {
  goals: 'Goals',
  assists: 'Assists',
  contributions: 'Goals + assists',
  clean_sheets: 'Clean sheets',
  penalty_saves: 'Penalty saves',
}

const METRIC_ORDER = ['goals', 'assists', 'contributions', 'clean_sheets', 'penalty_saves']

export function SessionReport({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<'night' | 'alltime'>('night')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['session-report', sessionId],
    queryFn: async () => (await api.get<Report>(`sessions/${sessionId}/report`)).data,
    enabled: !!sessionId,
  })

  if (isLoading) return <Skeleton className="h-64" />
  if (error) return <ErrorState message={(error as Error).message} onRetry={refetch} />
  if (!data) return null

  if (data.players.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="Nothing recorded yet"
        description="Once a match is played here, the full breakdown appears."
      />
    )
  }

  return (
    <FadeIn>
      {data.live && (
        <div className="mb-4 rounded-xl border border-card-yellow/30 bg-card-yellow/5 p-3.5">
          <p className="text-[13.5px] leading-relaxed text-chalk">
            This session is still going, so these numbers are moving.
          </p>
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <ViewTab active={view === 'night'} onClick={() => setView('night')}>Tonight</ViewTab>
        <ViewTab active={view === 'alltime'} onClick={() => setView('alltime')}>
          Every session ever
        </ViewTab>
      </div>

      {view === 'night' ? <Tonight report={data} /> : <AllTime report={data} />}
    </FadeIn>
  )
}

function Tonight({ report }: { report: Report }) {
  const a = report.attendance
  return (
    <div className="space-y-7">
      <section>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label="Played" value={report.summary.players} />
          <StatTile label="Goals" value={report.summary.goals} accent />
          <StatTile label="Assists" value={report.summary.assists} />
          <StatTile label="Matches" value={report.matches.length} />
        </div>
        <p className="mt-2.5 px-1 text-[13px] leading-relaxed text-chalk-muted">
          Session number {report.session.number} since the club started.
          {a.present > 0 && <> {a.present} turned up</>}
          {a.late + a.very_late > 0 && <>, {a.late + a.very_late} of them late</>}
          {a.present > 0 && '.'}
        </p>
      </section>

      {report.headlines.length > 0 && (
        <section>
          <SectionTitle>Worth shouting about</SectionTitle>
          <div className="space-y-2">
            {report.headlines.map((line, i) => (
              <Card key={i} className="flex gap-3">
                <span className="text-[17px] leading-none">🔥</span>
                <p className="text-[14.5px] leading-relaxed text-chalk">{line}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {report.best_on_the_night && (
        <section>
          <SectionTitle>Best on the night</SectionTitle>
          <Card className="flex items-center gap-3">
            <span className="text-2xl">⭐</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-chalk">{report.best_on_the_night.player}</span>
              <span className="block text-[13px] text-chalk-muted">
                {report.best_on_the_night.goals} goals · {report.best_on_the_night.assists} assists
              </span>
            </span>
            <span className="numeric text-2xl text-volt-400">
              {report.best_on_the_night.contributions}
            </span>
          </Card>
        </section>
      )}

      <section>
        <SectionTitle>Everyone who played</SectionTitle>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[320px] text-[14px]">
            <thead>
              <tr className="border-b border-pitch-700/60 text-[11px] uppercase tracking-wider text-chalk-faint">
                <th className="px-4 py-2 text-left font-medium">Player</th>
                <th className="px-2 py-2 text-right font-medium">G</th>
                <th className="px-2 py-2 text-right font-medium">A</th>
                <th className="px-2 py-2 text-right font-medium">CS</th>
                <th className="px-2 py-2 pr-4 text-right font-medium">G/A</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pitch-700/40">
              {report.players.map((p) => (
                <tr key={p.player_id}>
                  <td className="max-w-[130px] truncate px-4 py-2 text-chalk">{p.player}</td>
                  <td className="numeric px-2 py-2 text-right text-chalk-muted">{p.goals}</td>
                  <td className="numeric px-2 py-2 text-right text-chalk-muted">{p.assists}</td>
                  <td className="numeric px-2 py-2 text-right text-chalk-muted">{p.clean_sheets}</td>
                  <td className="numeric px-2 py-2 pr-4 text-right text-volt-400">
                    {p.contributions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <ShareCard report={report} />
    </div>
  )
}

function AllTime({ report }: { report: Report }) {
  const top = report.alltime ?? {}
  const available = METRIC_ORDER.filter((m) => (top[m]?.length ?? 0) > 0)

  if (available.length === 0) {
    return (
      <Card>
        <p className="text-[14px] text-chalk-muted">Nothing recorded in any session yet.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-7">
      <p className="px-1 text-[13px] leading-relaxed text-chalk-muted">
        The best single sessions anyone has ever had. Tonight's entries are highlighted.
      </p>
      {available.map((metric) => (
        <section key={metric}>
          <SectionTitle>{METRIC_TITLE[metric]} in one session</SectionTitle>
          <Card className="divide-y divide-pitch-700/60 p-0">
            {top[metric].map((e, i) => (
              <div
                key={`${e.player_id}-${e.date}-${i}`}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5',
                  e.is_this_session && 'bg-volt-400/10',
                )}
              >
                <span className="numeric w-5 text-[13px] text-chalk-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] text-chalk">{e.player}</span>
                  <span className="block text-[12.5px] text-chalk-muted">
                    {shortDate(e.date)}
                    {e.is_this_session ? ' · tonight' : ''}
                  </span>
                </span>
                <span className="numeric text-[17px] text-volt-400">{e.value}</span>
              </div>
            ))}
          </Card>
        </section>
      ))}
    </div>
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

function ShareCard({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => chatMessage(report), [report])

  return (
    <Card>
      <h3 className="text-[16px]">Send it to the group</h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-muted">
        Tonight written out, ready to paste into WhatsApp.
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
    </Card>
  )
}

function chatMessage(report: Report): string {
  const lines: string[] = []
  const when = new Date(report.session.date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  lines.push(`*${(report.session.title || 'SESSION').toUpperCase()} — ${when.toUpperCase()}*`, '')
  lines.push(
    `${report.summary.players} played · ${report.summary.goals} goals · ` +
      `${report.summary.assists} assists · ${report.matches.length} ` +
      `${report.matches.length === 1 ? 'match' : 'matches'}`,
    '',
  )

  if (report.best_on_the_night) {
    lines.push(
      `⭐ Best on the night: ${report.best_on_the_night.player} — ` +
        `${report.best_on_the_night.goals}G ${report.best_on_the_night.assists}A`,
      '',
    )
  }

  if (report.headlines.length > 0) {
    for (const h of report.headlines) lines.push(`@ ${h}`)
    lines.push('')
  }

  lines.push('*GOALS / ASSISTS*', '')
  for (const p of report.players) {
    if (p.goals === 0 && p.assists === 0) continue
    lines.push(`${p.player} — ${p.goals}G ${p.assists}A`)
  }

  return lines.join('\n')
}
