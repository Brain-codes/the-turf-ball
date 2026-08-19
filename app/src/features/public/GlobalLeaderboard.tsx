/**
 * The global leaderboard — every public team's players and teams, ranked
 * side by side. Livescore-style: search, sort, paginate. Public, no login,
 * same rules as the rest of `public`: read-only, only what teams opted into.
 *
 * Table shape is deliberately modelled on a Premier League standings table —
 * position, columns of raw stats, a sortable header row — rather than a flat
 * mobile list, since that's the mental model everyone already has for "a
 * league table."
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/services/client'
import { cn } from '@/lib/cn'
import { EmptyState, ErrorState, Input, PlayerAvatar, PlayerName, Skeleton } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { PublicNavbar } from '@/components/layout/PublicNavbar'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

interface Team {
  id: string
  name: string
  short_name: string | null
  slug: string
  logo_url: string | null
  location?: string | null
}

interface GlobalPlayerRow {
  player: {
    id: string
    display_name: string
    whatsapp_nickname: string | null
    photo_url: string | null
    jersey_number: number | null
    position: string | null
  }
  team: Team
  appearances: number
  goals: number
  own_goals: number
  assists: number
  clean_sheets: number
  saves: number
}

interface GlobalTeamRow {
  team: Team
  player_count: number
  appearances: number
  goals: number
  own_goals: number
  assists: number
  clean_sheets: number
  saves: number
}

interface Column<Row> {
  key: string
  label: string
  short: string
  value: (row: Row) => number
}

const PLAYER_COLUMNS: Column<GlobalPlayerRow>[] = [
  { key: 'appearances', label: 'Appearances', short: 'Apps', value: (r) => r.appearances },
  { key: 'goals', label: 'Goals', short: 'G', value: (r) => r.goals },
  { key: 'assists', label: 'Assists', short: 'A', value: (r) => r.assists },
  { key: 'clean_sheets', label: 'Clean sheets', short: 'CS', value: (r) => r.clean_sheets },
  { key: 'saves', label: 'Saves', short: 'SV', value: (r) => r.saves },
]

const TEAM_COLUMNS: Column<GlobalTeamRow>[] = [
  { key: 'appearances', label: 'Appearances', short: 'Apps', value: (r) => r.appearances },
  { key: 'goals', label: 'Goals', short: 'GF', value: (r) => r.goals },
  { key: 'assists', label: 'Assists', short: 'A', value: (r) => r.assists },
  { key: 'clean_sheets', label: 'Clean sheets', short: 'CS', value: (r) => r.clean_sheets },
]

export function GlobalLeaderboardScreen() {
  const [tab, setTab] = useState<'players' | 'teams'>('players')

  return (
    <div className="min-h-dvh pb-16">
      <PublicNavbar />

      <FadeIn>
        <header className="pitch-lines px-5 pb-8 pt-10 text-center">
          <div className="mb-3 text-4xl">🏆</div>
          <h1 className="text-[clamp(1.75rem,7vw,2.5rem)] leading-tight">The Turf Ball table</h1>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-chalk-muted">
            Every public group, one table. Ranked on the real numbers.
          </p>
        </header>
      </FadeIn>

      <div className="mx-auto max-w-4xl px-5">
        <div className="mb-5 flex gap-2">
          <TabButton active={tab === 'players'} onClick={() => setTab('players')}>Players</TabButton>
          <TabButton active={tab === 'teams'} onClick={() => setTab('teams')}>Teams</TabButton>
        </div>

        {tab === 'players' ? <GlobalPlayersTable /> : <GlobalTeamsTable />}

        <p className="mt-10 text-center text-[12.5px] text-chalk-faint">
          Powered by <span className="text-chalk-muted">The Turf Ball</span>
        </p>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'flex-1 rounded-full bg-volt-400 px-4 py-2 text-[14px] font-semibold text-void transition-colors'
          : 'flex-1 rounded-full border border-pitch-700 px-4 py-2 text-[14px] text-chalk-muted transition-colors hover:text-chalk'
      }
    >
      {children}
    </button>
  )
}

function GlobalPlayersTable() {
  const [sort, setSort] = useState('goals')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search, 300)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['global-players', sort, debouncedSearch, page],
    queryFn: async () => {
      const result = await api.public<GlobalPlayerRow[]>('public/leaderboard/players', {
        sort, search: debouncedSearch || undefined, page,
      })
      return { rows: result.data, meta: result.meta as { total_pages: number } }
    },
  })

  return (
    <div>
      <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search players…" />

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={refetch} />
      ) : (data?.rows ?? []).length === 0 ? (
        <EmptyState icon="⚽" title="No players yet" description="Once public groups start recording games, they'll show up here." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-pitch-700 bg-pitch-800/60 text-[11px] uppercase tracking-wider text-chalk-muted">
                  <th className="w-10 px-3 py-2.5 text-center">Pos</th>
                  <th className="px-3 py-2.5">Player</th>
                  {PLAYER_COLUMNS.map((col) => (
                    <SortableHeader key={col.key} col={col} sort={sort} onSort={(v) => { setSort(v); setPage(1) }} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-pitch-700">
                {data!.rows.map((row, i) => (
                  <tr key={row.player.id} className="transition-colors hover:bg-pitch-800/60">
                    <td className="px-3 py-2.5 text-center">
                      <span className="numeric text-[13px] text-chalk-muted">{(page - 1) * 20 + i + 1}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link to={`/t/${row.team.slug}/player/${row.player.id}`} className="flex min-w-0 items-center gap-2.5">
                        <PlayerAvatar name={row.player.display_name} photoUrl={row.player.photo_url} size="sm" />
                        <span className="min-w-0">
                          <PlayerName
                            name={row.player.display_name}
                            whatsappNickname={row.player.whatsapp_nickname}
                            className="block truncate text-[14px] text-chalk"
                          />
                          <span className="block truncate text-[11.5px] text-chalk-faint">
                            {row.team.short_name || row.team.name}
                          </span>
                        </span>
                      </Link>
                    </td>
                    {PLAYER_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'numeric px-3 py-2.5 text-center text-[14px]',
                          col.key === sort ? 'font-semibold text-volt-400' : 'text-chalk-muted',
                        )}
                      >
                        {col.value(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={data?.meta.total_pages ?? 1} onChange={setPage} />
        </>
      )}
    </div>
  )
}

function GlobalTeamsTable() {
  const [sort, setSort] = useState('goals')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search, 300)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['global-teams', sort, debouncedSearch, page],
    queryFn: async () => {
      const result = await api.public<GlobalTeamRow[]>('public/leaderboard/teams', {
        sort, search: debouncedSearch || undefined, page,
      })
      return { rows: result.data, meta: result.meta as { total_pages: number } }
    },
  })

  return (
    <div>
      <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search teams…" />

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={refetch} />
      ) : (data?.rows ?? []).length === 0 ? (
        <EmptyState icon="🏟️" title="No teams yet" description="Public groups will show up here once they've played." />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-pitch-700 bg-pitch-800/60 text-[11px] uppercase tracking-wider text-chalk-muted">
                  <th className="w-10 px-3 py-2.5 text-center">Pos</th>
                  <th className="px-3 py-2.5">Team</th>
                  <th className="px-3 py-2.5 text-center">Squad</th>
                  {TEAM_COLUMNS.map((col) => (
                    <SortableHeader key={col.key} col={col} sort={sort} onSort={(v) => { setSort(v); setPage(1) }} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-pitch-700">
                {data!.rows.map((row, i) => (
                  <tr key={row.team.id} className="transition-colors hover:bg-pitch-800/60">
                    <td className="px-3 py-2.5 text-center">
                      <span className="numeric text-[13px] text-chalk-muted">{(page - 1) * 20 + i + 1}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link to={`/t/${row.team.slug}`} className="flex min-w-0 items-center gap-2.5">
                        {row.team.logo_url ? (
                          <img src={row.team.logo_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pitch-800 text-sm">⚽</div>
                        )}
                        <span className="truncate text-[14px] text-chalk">{row.team.name}</span>
                      </Link>
                    </td>
                    <td className="numeric px-3 py-2.5 text-center text-[13px] text-chalk-muted">
                      {row.player_count}
                    </td>
                    {TEAM_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'numeric px-3 py-2.5 text-center text-[14px]',
                          col.key === sort ? 'font-semibold text-volt-400' : 'text-chalk-muted',
                        )}
                      >
                        {col.value(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={data?.meta.total_pages ?? 1} onChange={setPage} />
        </>
      )}
    </div>
  )
}

function SortableHeader<Row>({
  col, sort, onSort,
}: {
  col: Column<Row>
  sort: string
  onSort: (v: string) => void
}) {
  const active = col.key === sort
  return (
    <th className="px-3 py-2.5 text-center">
      <button
        onClick={() => onSort(col.key)}
        title={col.label}
        className={cn(
          'transition-colors',
          active ? 'text-volt-400' : 'hover:text-chalk',
        )}
      >
        {col.short}
      </button>
    </th>
  )
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-4"
    />
  )
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-full border border-pitch-700 px-3.5 py-1.5 text-[13px] text-chalk-muted disabled:opacity-40"
      >
        ← Prev
      </button>
      <span className="text-[13px] text-chalk-muted">Page {page} of {totalPages}</span>
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="rounded-full border border-pitch-700 px-3.5 py-1.5 text-[13px] text-chalk-muted disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
    </div>
  )
}
