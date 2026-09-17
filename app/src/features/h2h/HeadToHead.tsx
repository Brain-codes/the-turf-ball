/**
 * Head to head — two players side by side, from any two teams.
 *
 * One screen, two homes:
 *   - `/h2h` (public): anyone, public teams only.
 *   - `/app/h2h` (signed in): also includes the admin's own team, even when
 *     it isn't public.
 *
 * Each side has its own picker: optionally narrow to a team first, then
 * search for a player — so the two players can come from completely
 * different groups. The chosen pair lives in the URL (?a=&b=) so a
 * comparison can be shared as a link.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/services/client'
import { cn } from '@/lib/cn'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import { PublicNavbar } from '@/components/layout/PublicNavbar'
import { FadeIn } from '@/components/motion'
import { Button, Card, EmptyState, ErrorState, Input, PlayerAvatar, PlayerName, Select, Skeleton } from '@/components/ui'
import { renderShareCard, type CardRow } from './shareCard'

type Mode = 'public' | 'member'

interface H2HTeam {
  id: string
  name: string
  short_name: string | null
  slug: string
  logo_url: string | null
  is_own: boolean
  is_public: boolean
}

interface H2HPlayer {
  id: string
  display_name: string
  whatsapp_nickname: string | null
  photo_url: string | null
  jersey_number: number | null
  position: string | null
}

interface H2HSide {
  player: H2HPlayer
  team: H2HTeam
  totals: Record<string, number>
  per_game: Record<string, number>
  awards: Record<string, number>
}

interface H2HResult {
  a: H2HSide
  b: H2HSide
}

/** Public routes are anonymous; member routes carry the token and active group. */
function fetcher(mode: Mode) {
  const base = mode === 'public' ? 'public/h2h' : 'stats/h2h'
  return <T,>(path: string, query: Record<string, string | undefined>) =>
    mode === 'public'
      ? api.public<T>(`${base}${path}`, query)
      : api.get<T>(`${base}${path}`, query)
}

/** Rows in the comparison. `lowerIsBetter` flips which side gets highlighted. */
/** `card` marks the rows that also go on the shareable image (it only has room for eight). */
const ROWS: { label: string; get: (s: H2HSide) => number; lowerIsBetter?: boolean; decimals?: boolean; card?: boolean }[] = [
  { label: 'Appearances', get: (s) => s.totals.appearances, card: true },
  { label: 'Goals', get: (s) => s.totals.goals, card: true },
  { label: 'Assists', get: (s) => s.totals.assists, card: true },
  { label: 'Goals + assists', get: (s) => s.totals.goals + s.totals.assists, card: true },
  { label: 'Goals per game', get: (s) => s.per_game.goals, decimals: true, card: true },
  { label: 'Assists per game', get: (s) => s.per_game.assists, decimals: true },
  { label: 'Clean sheets', get: (s) => s.totals.clean_sheets, card: true },
  { label: 'Saves', get: (s) => s.totals.saves },
  { label: 'Penalty saves', get: (s) => s.totals.penalty_saves, card: true },
  { label: 'Awards won', get: (s) => Object.values(s.awards).reduce((n, v) => n + v, 0), card: true },
  { label: 'Own goals', get: (s) => s.totals.own_goals, lowerIsBetter: true },
  { label: 'Yellow cards', get: (s) => s.totals.yellow_cards, lowerIsBetter: true },
  { label: 'Red cards', get: (s) => s.totals.red_cards, lowerIsBetter: true },
]

export function PublicHeadToHeadScreen() {
  return (
    <div className="min-h-dvh pb-16">
      <PublicNavbar />
      <FadeIn>
        <header className="pitch-lines px-5 pb-6 pt-10 text-center">
          <div className="mb-3 text-4xl">⚔️</div>
          <h1 className="text-[clamp(1.75rem,7vw,2.5rem)] leading-tight">Head to head</h1>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-chalk-muted">
            Pick any two players, from any two teams, and see who comes out on top.
          </p>
        </header>
      </FadeIn>
      <div className="mx-auto max-w-3xl px-5">
        <HeadToHead mode="public" />
      </div>
    </div>
  )
}

export function MemberHeadToHeadScreen() {
  return (
    <div className="pb-8">
      <PageHeader title="Head to head" subtitle="Your players, or anyone on a public team" />
      <div className="px-5">
        <HeadToHead mode="member" />
      </div>
    </div>
  )
}

function HeadToHead({ mode }: { mode: Mode }) {
  const { activeOrg } = useAuth()
  const [params, setParams] = useSearchParams()
  const a = params.get('a')
  const b = params.get('b')
  const get = fetcher(mode)

  const setSide = (key: 'a' | 'b', id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set(key, id)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['h2h', mode, activeOrg?.id, a, b],
    queryFn: async () => (await get<H2HResult>('', { a: a!, b: b! })).data,
    enabled: !!a && !!b && a !== b && (mode === 'public' || !!activeOrg),
  })

  return (
    <div className="space-y-5">
      <div className="grid items-start gap-3 md:grid-cols-2">
        <SidePicker mode={mode} label="Player 1" selectedId={a} excludeId={b} loaded={data?.a} onChange={(id) => setSide('a', id)} />
        <SidePicker mode={mode} label="Player 2" selectedId={b} excludeId={a} loaded={data?.b} onChange={(id) => setSide('b', id)} />
      </div>

      {!a || !b ? (
        <EmptyState icon="⚔️" title="Pick two players" description="Choose a team on each side (or search everyone), then pick a player." />
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={refetch} />
      ) : data ? (
        <Comparison result={data} />
      ) : null}
    </div>
  )
}

function SidePicker({
  mode, label, selectedId, excludeId, loaded, onChange,
}: {
  mode: Mode
  label: string
  selectedId: string | null
  excludeId: string | null
  /** The side as returned by the comparison — covers a pair opened from a shared link. */
  loaded?: { player: H2HPlayer; team: H2HTeam }
  onChange: (id: string | null) => void
}) {
  const { activeOrg } = useAuth()
  const get = fetcher(mode)
  const [teamId, setTeamId] = useState('')
  const [teamSearch, setTeamSearch] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<{ player: H2HPlayer; team: H2HTeam } | null>(null)
  const debouncedTeam = useDebouncedValue(teamSearch, 300)
  const debounced = useDebouncedValue(search, 300)
  const ready = mode === 'public' || !!activeOrg

  const { data: teams } = useQuery({
    queryKey: ['h2h-teams', mode, activeOrg?.id, debouncedTeam],
    queryFn: async () => (await get<H2HTeam[]>('/teams', { search: debouncedTeam || undefined })).data,
    enabled: ready,
  })

  const { data: players, isLoading } = useQuery({
    queryKey: ['h2h-players', mode, activeOrg?.id, teamId, debounced],
    queryFn: async () =>
      (await get<{ player: H2HPlayer; team: H2HTeam }[]>('/players', {
        team_id: teamId || undefined,
        search: debounced || undefined,
      })).data,
    // Searching "everyone" needs at least a couple of letters; a chosen team lists its whole squad.
    enabled: ready && !selectedId && (!!teamId || debounced.length >= 2),
  })

  if (selectedId) {
    const shown = [picked, loaded].find((x) => x?.player.id === selectedId)
    return (
      <Card className="flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-wider text-chalk-muted">{label}</span>
        {shown ? (
          <>
            <PlayerAvatar name={shown.player.display_name} photoUrl={shown.player.photo_url} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-chalk">{shown.player.display_name}</span>
              <span className="block truncate text-[11.5px] text-chalk-faint">{shown.team.name}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-[14px] text-chalk-muted">Selected</span>
        )}
        <button
          onClick={() => { setPicked(null); onChange(null) }}
          className="rounded-full border border-pitch-700 px-3 py-1 text-[12.5px] text-chalk-muted hover:text-chalk"
        >
          Change
        </button>
      </Card>
    )
  }

  const list = (players ?? []).filter((r) => r.player.id !== excludeId)

  return (
    <Card className="space-y-2.5">
      <div className="text-[11px] uppercase tracking-wider text-chalk-muted">{label}</div>

      <Input
        value={teamSearch}
        onChange={(e) => setTeamSearch(e.target.value)}
        placeholder="Find a team…"
        className="h-9 text-[14px]"
      />
      <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-9 text-[14px]">
        <option value="">All teams</option>
        {teams?.map((t) => (
          <option key={t.id} value={t.id}>{t.is_own ? `${t.name} (your team)` : t.name}</option>
        ))}
      </Select>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={teamId ? 'Filter this squad…' : 'Search players by name…'}
        className="h-9 text-[14px]"
      />

      <div className="max-h-64 overflow-y-auto">
        {!teamId && debounced.length < 2 ? (
          <p className="px-1 py-2 text-[12.5px] text-chalk-faint">Pick a team, or type at least 2 letters.</p>
        ) : isLoading ? (
          <Skeleton className="h-10" />
        ) : list.length === 0 ? (
          <p className="px-1 py-2 text-[12.5px] text-chalk-faint">No players found.</p>
        ) : (
          <ul className="divide-y divide-pitch-700">
            {list.map((row) => (
              <li key={row.player.id}>
                <button
                  onClick={() => { setPicked(row); onChange(row.player.id) }}
                  className="flex w-full items-center gap-2.5 px-1 py-2 text-left hover:bg-pitch-800/60"
                >
                  <PlayerAvatar name={row.player.display_name} photoUrl={row.player.photo_url} size="xs" />
                  <span className="min-w-0 flex-1">
                    <PlayerName
                      name={row.player.display_name}
                      whatsappNickname={row.player.whatsapp_nickname}
                      className="block truncate text-[14px] text-chalk"
                    />
                    <span className="block truncate text-[11.5px] text-chalk-faint">{row.team.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function Comparison({ result }: { result: H2HResult }) {
  const { a, b } = result
  let aWins = 0
  let bWins = 0
  for (const row of ROWS) {
    const va = row.get(a)
    const vb = row.get(b)
    if (va === vb) continue
    const aBetter = row.lowerIsBetter ? va < vb : va > vb
    if (aBetter) aWins++
    else bWins++
  }

  return (
    <FadeIn>
      <ShareBar result={result} score={{ a: aWins, b: bWins }} />
      <Card className="p-0">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-pitch-700 p-4">
          <SideHeader side={a} />
          <div className="numeric text-center text-2xl text-chalk">
            <span className={cn(aWins > bWins && 'text-volt-400')}>{aWins}</span>
            <span className="mx-1.5 text-chalk-faint">–</span>
            <span className={cn(bWins > aWins && 'text-volt-400')}>{bWins}</span>
            <div className="mt-1 text-[10.5px] uppercase tracking-wider text-chalk-muted">Categories won</div>
          </div>
          <SideHeader side={b} />
        </div>

        <ul className="divide-y divide-pitch-700">
          {ROWS.map((row) => {
            const va = row.get(a)
            const vb = row.get(b)
            const aBetter = va !== vb && (row.lowerIsBetter ? va < vb : va > vb)
            const bBetter = va !== vb && !aBetter
            const fmt = (v: number) => (row.decimals ? v.toFixed(2) : String(v))
            return (
              <li key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2.5">
                <span className={cn('numeric text-right text-[15px]', aBetter ? 'font-semibold text-volt-400' : 'text-chalk-muted')}>
                  {fmt(va)}
                </span>
                <span className="min-w-[8.5rem] text-center text-[12px] uppercase tracking-wider text-chalk-faint">{row.label}</span>
                <span className={cn('numeric text-left text-[15px]', bBetter ? 'font-semibold text-volt-400' : 'text-chalk-muted')}>
                  {fmt(vb)}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>
      <p className="mt-3 text-center text-[12px] text-chalk-faint">
        All-time numbers from each player's own team.
      </p>
    </FadeIn>
  )
}

function SideHeader({ side }: { side: H2HSide }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <PlayerAvatar name={side.player.display_name} photoUrl={side.player.photo_url} size="lg" />
      <span className="w-full truncate text-[14.5px] font-semibold text-chalk">{side.player.display_name}</span>
      <span className="w-full truncate text-[11.5px] text-chalk-faint">
        {side.team.name}{side.player.position ? ` · ${side.player.position}` : ''}
      </span>
    </div>
  )
}

function winnerOf(row: (typeof ROWS)[number], va: number, vb: number): 'a' | 'b' | null {
  if (va === vb) return null
  return (row.lowerIsBetter ? va < vb : va > vb) ? 'a' : 'b'
}

/**
 * Share, download and copy-link. The link always points at the PUBLIC page
 * so anyone can open it; the caption carries the link alongside the image.
 */
function ShareBar({ result, score }: { result: H2HResult; score: { a: number; b: number } }) {
  const { a, b } = result
  const [busy, setBusy] = useState<'share' | 'download' | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const link = `${window.location.origin}/h2h?a=${a.player.id}&b=${b.player.id}`
  const caption = `${a.player.display_name} vs ${b.player.display_name}: ${score.a}-${score.b} on The Turf Ball. Who's better? ${link}`
  const privateTeam = !a.team.is_public || !b.team.is_public
  const fileName = `h2h-${a.player.display_name}-vs-${b.player.display_name}.png`.replace(/[^\w.-]+/g, '-').toLowerCase()

  const flash = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(null), 2500)
  }

  const makeImage = () => {
    const rows: CardRow[] = ROWS.filter((r) => r.card).map((r) => {
      const va = r.get(a)
      const vb = r.get(b)
      return { label: r.label, a: va, b: vb, winner: winnerOf(r, va, vb), decimals: r.decimals }
    })
    const side = (s: H2HSide) => ({
      name: s.player.display_name,
      team: s.team.short_name || s.team.name,
      position: s.player.position,
      photoUrl: s.player.photo_url,
    })
    return renderShareCard({ a: side(a), b: side(b), score, rows, link })
  }

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = fileName
    el.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption)
      return true
    } catch {
      return false
    }
  }

  const onShare = async () => {
    setBusy('share')
    try {
      const blob = await makeImage()
      const file = new File([blob], fileName, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        // Some apps (WhatsApp included) drop `text` when a file is attached,
        // so the caption is also put on the clipboard to paste if needed.
        await copyCaption()
        await navigator.share({ files: [file], text: caption })
      } else {
        // Desktop browsers mostly can't share files: download + copy instead.
        download(blob)
        flash((await copyCaption()) ? 'Image downloaded, caption with link copied' : 'Image downloaded')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') flash('Could not share, try Download instead')
    } finally {
      setBusy(null)
    }
  }

  const onDownload = async () => {
    setBusy('download')
    try {
      download(await makeImage())
    } catch {
      flash('Could not create the image')
    } finally {
      setBusy(null)
    }
  }

  const onCopy = async () => {
    flash((await copyCaption()) ? 'Caption with link copied' : 'Could not copy')
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onShare} disabled={!!busy} className="flex-1">
          {busy === 'share' ? 'Preparing…' : '📤 Share'}
        </Button>
        <Button variant="secondary" onClick={onDownload} disabled={!!busy} className="flex-1">
          {busy === 'download' ? 'Preparing…' : '⬇️ Download image'}
        </Button>
        <Button variant="secondary" onClick={onCopy} className="flex-1">
          🔗 Copy link
        </Button>
      </div>
      {note && <p className="mt-2 text-center text-[12.5px] text-volt-400">{note}</p>}
      {privateTeam && (
        <p className="mt-2 text-center text-[12px] text-chalk-faint">
          One of these teams isn't public, so the image works but the link won't open for other people.
        </p>
      )}
    </div>
  )
}
