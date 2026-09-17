import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/services/client'
import { ErrorState, Skeleton } from '@/components/ui'
import { AdminHeader } from './shared'

type Overview = {
  totals: {
    users: number
    new_users_7d: number
    groups: number
    suspended_groups: number
    players: number
    sessions: number
    live_sessions: number
    matches: number
    goals: number
    assists: number
    new_messages: number
  }
  trend: { date: string; users: number; groups: number }[]
}

function Tile({ label, value, note, to }: { label: string; value: number; note?: string; to?: string }) {
  const body = (
    <>
      <p className="text-[12px] uppercase tracking-wider text-chalk-muted">{label}</p>
      <p className="numeric mt-2 text-4xl text-chalk">{value.toLocaleString()}</p>
      {note && <p className="mt-1 text-[12.5px] text-chalk-faint">{note}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="surface block p-4 transition-colors hover:border-pitch-600">{body}</Link>
  ) : (
    <div className="surface p-4">{body}</div>
  )
}

/** New accounts per day, last 30 days. One series, so the title names it. */
function SignupChart({ data }: { data: Overview['trend'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.users))
  const W = 600
  const H = 160
  const gap = 2
  const bw = W / data.length - gap
  const total = data.reduce((n, d) => n + d.users, 0)
  const h = hover !== null ? data[hover] : null

  return (
    <figure className="surface p-5">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="font-display text-[16px] font-bold">New accounts per day</span>
        <span className="text-[13px] text-chalk-muted">{total} in the last 30 days</span>
      </figcaption>
      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="img" aria-label={`New accounts per day over the last 30 days, ${total} in total, most in one day ${max}.`}>
          {[0.5, 1].map((f) => (
            <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} stroke="var(--color-pitch-700)" strokeWidth={1} strokeDasharray="2 4" />
          ))}
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--color-pitch-600)" strokeWidth={1} />
          {data.map((d, i) => {
            const bh = d.users === 0 ? 0 : Math.max(3, (d.users / max) * (H - 8))
            const x = i * (bw + gap)
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
                {bh > 0 && (
                  <path
                    d={`M${x},${H} v${-(bh - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${bh - 3} z`}
                    fill="var(--color-volt-400)"
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
              </g>
            )
          })}
          <text x={0} y={H + 16} fill="var(--color-chalk-faint)" fontSize={11}>{data[0]?.date.slice(5)}</text>
          <text x={W} y={H + 16} fill="var(--color-chalk-faint)" fontSize={11} textAnchor="end">Today</text>
          <text x={W} y={H - H + 10} fill="var(--color-chalk-faint)" fontSize={11} textAnchor="end">{max}</text>
        </svg>
        {h && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-lg border border-pitch-600 bg-pitch-800 px-3 py-2 text-[12.5px] shadow-lg"
            style={{ left: `clamp(0px, calc(${((hover! + 0.5) / data.length) * 100}% - 60px), calc(100% - 120px))` }}
          >
            <p className="text-chalk-muted">{new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
            <p className="text-chalk"><span className="tabular font-semibold">{h.users}</span> accounts · <span className="tabular">{h.groups}</span> groups</p>
          </div>
        )}
      </div>
      <details className="mt-3 text-[13px] text-chalk-muted">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr className="text-chalk-faint"><th className="py-1 font-normal">Date</th><th className="font-normal">Accounts</th><th className="font-normal">Groups</th></tr></thead>
          <tbody>
            {data.filter((d) => d.users || d.groups).map((d) => (
              <tr key={d.date} className="border-t border-pitch-800"><td className="py-1">{d.date}</td><td className="tabular">{d.users}</td><td className="tabular">{d.groups}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export function AdminOverview() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => (await api.get<Overview>('admin/overview')).data,
    refetchInterval: 60_000,
  })

  return (
    <>
      <AdminHeader title="Overview" subtitle="Everything happening on The Turf Ball." />
      {isLoading && <Skeleton className="h-96" />}
      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Accounts" value={data.totals.users} note={`${data.totals.new_users_7d} new this week`} to="/admin/users" />
            <Tile label="Groups" value={data.totals.groups} note={data.totals.suspended_groups ? `${data.totals.suspended_groups} suspended` : 'None suspended'} to="/admin/groups" />
            <Tile label="Players" value={data.totals.players} />
            <Tile label="New messages" value={data.totals.new_messages} note="From the contact form" to="/admin/messages" />
            <Tile label="Sessions" value={data.totals.sessions} note={`${data.totals.live_sessions} live now`} />
            <Tile label="Matches" value={data.totals.matches} />
            <Tile label="Goals" value={data.totals.goals} />
            <Tile label="Assists" value={data.totals.assists} />
          </div>
          <SignupChart data={data.trend} />
        </div>
      )}
    </>
  )
}
