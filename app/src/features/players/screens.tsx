import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input,
  PlayerAvatar, PlayerName, PositionSelect, SectionTitle, Select, Skeleton, StatTile,
} from '@/components/ui'
import { FadeIn, Sheet, Stagger, StaggerItem } from '@/components/motion'
import { POSITION_LABEL, points, shortDate } from '@/lib/format'
import { compressImage } from '@/lib/file'
import type { Award, Player, PlayerStats } from '@/types'

/* -------------------------------------------------------------------------- */
/* Squad list                                                                  */
/* -------------------------------------------------------------------------- */

export function PlayersScreen() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['players', activeOrg?.id],
    queryFn: async () =>
      (await api.get<Player[]>('players', { with_stats: true })).data,
    enabled: !!activeOrg,
  })

  // Self-serve joins via the invite link (/play/:slug) land here as
  // status='pending' and never appear in the default squad list — this is
  // the ongoing home for approving/rejecting them, not just during onboarding.
  const { data: pending, refetch: refetchPending } = useQuery({
    queryKey: ['players-pending', activeOrg?.id],
    queryFn: async () => (await api.get<Player[]>('players', { status: 'pending' })).data,
    enabled: !!activeOrg,
    refetchInterval: 20000,
  })

  const decide = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api.post(`players/${id}/${action}`),
    onSuccess: () => {
      refetchPending()
      queryClient.invalidateQueries({ queryKey: ['players'] })
    },
  })

  const filtered = (data ?? []).filter((p) =>
    p.display_name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="pb-8">
      <PageHeader
        title="Squad"
        subtitle={data ? `${data.length} player${data.length === 1 ? '' : 's'}` : undefined}
        action={<Button onClick={() => setAddOpen(true)}>Add</Button>}
      />

      {pending && pending.length > 0 && (
        <div className="px-5 pb-5">
          <SectionTitle>
            Waiting for approval ({pending.length})
          </SectionTitle>
          <Card className="mt-2 divide-y divide-pitch-700 !p-0">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3.5 py-3">
                <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                <PlayerName
                  name={p.display_name}
                  whatsappNickname={p.whatsapp_nickname}
                  className="flex-1 text-[14px] text-chalk"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  loading={decide.isPending && decide.variables?.id === p.id && decide.variables.action === 'reject'}
                  onClick={() => decide.mutate({ id: p.id, action: 'reject' })}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  loading={decide.isPending && decide.variables?.id === p.id && decide.variables.action === 'approve'}
                  onClick={() => decide.mutate({ id: p.id, action: 'approve' })}
                >
                  Approve
                </Button>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div className="px-5">
        {(data?.length ?? 0) > 6 && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players"
            className="mb-4"
          />
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={refetch} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="👥"
            title={search ? 'Nobody matches that' : 'No players yet'}
            description={search ? undefined : 'Add the people who turn up every week.'}
            action={!search && <Button onClick={() => setAddOpen(true)}>Add players</Button>}
          />
        ) : (
          <Stagger className="surface divide-y divide-pitch-700 overflow-hidden">
            {filtered.map((player) => (
              <StaggerItem key={player.id}>
                <Link
                  to={`/app/players/${player.id}`}
                  className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-pitch-800"
                >
                  <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <PlayerName
                        name={player.display_name}
                        whatsappNickname={player.whatsapp_nickname}
                        className="text-[15px] text-chalk"
                      />
                      {player.status === 'guest' && <Badge>Guest</Badge>}
                    </span>
                    <span className="text-[12.5px] text-chalk-muted">
                      {player.position ? POSITION_LABEL[player.position] : 'No position set'}
                      {player.jersey_number !== null && ` · #${player.jersey_number}`}
                    </span>
                  </span>
                  {player.stats && player.stats.appearances > 0 && (
                    <span className="text-right">
                      <span className="numeric block text-lg text-volt-400">
                        {points(player.stats.total_points)}
                      </span>
                      <span className="text-[11px] text-chalk-muted">
                        {player.stats.goals}G {player.stats.assists}A
                      </span>
                    </span>
                  )}
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>

      <AddPlayersSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ['players'] })
          setAddOpen(false)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Add players — quick (names only) or full details (kit, foot, position,     */
/* WhatsApp nickname, photo) — same fields the onboarding wizard collects.    */
/* -------------------------------------------------------------------------- */

const FEET = [
  { value: '', label: 'No preference' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
] as const

function AddPlayersSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<'quick' | 'full'>('quick')

  return (
    <Sheet open={open} onClose={onClose} title="Add players">
      <div className="mb-4 flex gap-2 rounded-lg bg-pitch-900 p-1">
        <button
          onClick={() => setMode('quick')}
          className={`flex-1 rounded-md py-2 text-[13.5px] transition-colors ${mode === 'quick' ? 'bg-pitch-700 text-chalk' : 'text-chalk-muted'}`}
        >
          Quick add
        </button>
        <button
          onClick={() => setMode('full')}
          className={`flex-1 rounded-md py-2 text-[13.5px] transition-colors ${mode === 'full' ? 'bg-pitch-700 text-chalk' : 'text-chalk-muted'}`}
        >
          Full details
        </button>
      </div>
      {mode === 'quick' ? <QuickAddForm onDone={onDone} /> : <FullAddForm onDone={onDone} />}
    </Sheet>
  )
}

function QuickAddForm({ onDone }: { onDone: () => void }) {
  const [names, setNames] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (list: string[]) => api.post('players/bulk', { names: list }),
    onSuccess: () => {
      setNames('')
      onDone()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add those players'),
  })

  const list = names.split('\n').map((n) => n.trim()).filter(Boolean)

  return (
    <>
      <p className="mb-3 text-[14px] text-chalk-muted">
        One name per line. Shirt numbers, positions and photos can come later.
      </p>
      <textarea
        value={names}
        onChange={(e) => setNames(e.target.value)}
        rows={7}
        autoFocus
        placeholder={'Ade\nMike\nJohn'}
        className="w-full resize-none rounded-xl border border-pitch-700 bg-pitch-900 p-3.5 text-[15px] leading-8 text-chalk placeholder:text-chalk-faint focus:border-turf-400 focus:outline-none"
      />
      {error && <p className="mt-2 text-[14px] text-card-red">{error}</p>}
      <Button
        size="lg"
        fullWidth
        className="mt-4"
        loading={mutation.isPending}
        disabled={list.length === 0}
        onClick={() => mutation.mutate(list)}
      >
        Add {list.length > 0 ? `${list.length} player${list.length === 1 ? '' : 's'}` : 'players'}
      </Button>
    </>
  )
}

function FullAddForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    first_name: '',
    display_name: '',
    whatsapp_nickname: '',
    preferred_foot: '',
    position: '',
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const photo_base64 = photoFile ? await compressImage(photoFile) : undefined
      return api.post('players', {
        first_name: form.first_name.trim(),
        display_name: form.display_name.trim() || undefined,
        whatsapp_nickname: form.whatsapp_nickname.trim() || undefined,
        preferred_foot: form.preferred_foot || undefined,
        position: form.position || undefined,
        photo_base64,
      })
    },
    onSuccess: () => {
      setForm({ first_name: '', display_name: '', whatsapp_nickname: '', preferred_foot: '', position: '' })
      setPhotoFile(null)
      onDone()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add that player'),
  })

  return (
    <div className="space-y-3">
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
          className="block w-full text-[13px] text-chalk-muted file:mr-3 file:rounded-lg file:border-0 file:bg-pitch-700 file:px-3 file:py-2 file:text-[13px] file:text-chalk"
        />
      </Field>
      {error && <p className="text-[14px] text-card-red">{error}</p>}
      <Button
        size="lg"
        fullWidth
        loading={mutation.isPending}
        disabled={form.first_name.trim().length < 1}
        onClick={() => mutation.mutate()}
      >
        Add player
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Player profile                                                              */
/* -------------------------------------------------------------------------- */

interface PlayerDetail extends Player {
  stats: PlayerStats | null
  awards: Award[]
  history: (PlayerStats & { periods: { label: string } })[]
  recent_form: { date: string | null; goals: number; assists: number; cards: number }[]
}

export function PlayerProfileScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['player', id],
    queryFn: async () => (await api.get<PlayerDetail>(`players/${id}`)).data,
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="px-5 pt-8">
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-7 w-40" />
        <Skeleton className="mt-8 h-24" />
      </div>
    )
  }

  if (error) return <ErrorState message={(error as Error).message} onRetry={refetch} />
  if (!data) return null

  const stats = data.stats

  return (
    <div className="pb-8">
      <div className="px-5 pt-5">
        <button onClick={() => navigate(-1)} className="text-[14px] text-chalk-muted">
          ← Back
        </button>
      </div>

      <FadeIn className="pitch-lines px-5 pb-7 pt-5 text-center">
        <PlayerAvatar
          name={data.display_name}
          photoUrl={data.photo_url}
          size="xl"
          className="mx-auto"
        />
        <h1 className="mt-4 text-3xl">{data.display_name}</h1>
        {data.whatsapp_nickname && data.whatsapp_nickname.trim() !== data.display_name.trim() && (
          <p className="mt-0.5 text-[12px] text-chalk-faint/70">WhatsApp: {data.whatsapp_nickname}</p>
        )}
        <p className="mt-1 text-[14px] text-chalk-muted">
          {data.position ? POSITION_LABEL[data.position] : 'No position set'}
          {data.jersey_number !== null && ` · #${data.jersey_number}`}
        </p>

        {stats?.rank && stats.appearances > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-volt-400/10 px-4 py-1.5">
            <span className="numeric text-lg text-volt-400">#{stats.rank}</span>
            <span className="text-[13px] text-chalk-muted">this month</span>
          </div>
        )}
      </FadeIn>

      <div className="px-5">
        {stats && stats.appearances > 0 ? (
          <>
            <div className="mb-3 grid grid-cols-4 gap-2.5">
              <StatTile label="Goals" value={stats.goals} accent />
              <StatTile label="Assists" value={stats.assists} />
              <StatTile label="Apps" value={stats.appearances} />
              <StatTile label="Points" value={points(stats.total_points)} />
            </div>

            <div className="mb-7 grid grid-cols-3 gap-2.5">
              <StatTile label="Clean sheets" value={stats.clean_sheets} />
              <StatTile label="Yellows" value={stats.yellow_cards} />
              <StatTile label="Reds" value={stats.red_cards} />
            </div>
          </>
        ) : (
          <Card className="mb-7">
            <p className="py-2 text-center text-[14px] text-chalk-muted">
              No games played this month yet.
            </p>
          </Card>
        )}

        {data.recent_form.length > 0 && (
          <section className="mb-7">
            <SectionTitle>Recent games</SectionTitle>
            <div className="space-y-2">
              {data.recent_form.map((game, i) => (
                <Card key={i} className="flex items-center gap-3 py-3">
                  <span className="flex-1 text-[14px] text-chalk-muted">
                    {game.date ? shortDate(game.date) : 'Match'}
                  </span>
                  <span className="flex gap-1.5 text-[15px]">
                    {Array.from({ length: game.goals }, (_, k) => <span key={`g${k}`}>⚽</span>)}
                    {Array.from({ length: game.assists }, (_, k) => <span key={`a${k}`}>🅰️</span>)}
                    {Array.from({ length: game.cards }, (_, k) => <span key={`c${k}`}>🟨</span>)}
                    {game.goals + game.assists + game.cards === 0 && (
                      <span className="text-[13px] text-chalk-faint">—</span>
                    )}
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}

        {data.awards.length > 0 && (
          <section className="mb-7">
            <SectionTitle>Awards</SectionTitle>
            <div className="space-y-2">
              {data.awards.map((award, i) => (
                <Card key={i} className="flex items-center gap-3 py-3">
                  <span className="text-2xl">{award.award_types.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-chalk">{award.award_types.name}</span>
                    <span className="text-[13px] text-chalk-muted">{award.periods?.label}</span>
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}

        {data.history.length > 1 && (
          <section className="mb-7">
            <SectionTitle>Month by month</SectionTitle>
            <Card className="divide-y divide-pitch-700 p-0">
              {data.history.map((row) => (
                <div key={row.period_id} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="flex-1 text-[14px] text-chalk-muted">{row.periods?.label}</span>
                  <span className="text-[13px] text-chalk-muted">
                    {row.goals}G · {row.assists}A
                  </span>
                  <span className="numeric w-12 text-right text-[15px] text-chalk">
                    {points(row.total_points)}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}

        <Button variant="secondary" fullWidth onClick={() => setEditOpen(true)}>
          Edit player
        </Button>
      </div>

      <EditPlayerSheet
        player={data}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['player', id] })
          queryClient.invalidateQueries({ queryKey: ['players'] })
          setEditOpen(false)
        }}
        onRemoved={() => {
          queryClient.invalidateQueries({ queryKey: ['players'] })
          navigate('/app/players')
        }}
      />
    </div>
  )
}

function EditPlayerSheet({
  player,
  open,
  onClose,
  onSaved,
  onRemoved,
}: {
  player: Player
  open: boolean
  onClose: () => void
  onSaved: () => void
  onRemoved: () => void
}) {
  const [form, setForm] = useState({
    display_name: player.display_name,
    whatsapp_nickname: player.whatsapp_nickname ?? '',
    jersey_number: player.jersey_number?.toString() ?? '',
    position: player.position ?? '',
    status: player.status,
  })
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const save = useMutation({
    mutationFn: async () =>
      api.patch(`players/${player.id}`, {
        display_name: form.display_name,
        whatsapp_nickname: form.whatsapp_nickname.trim() || null,
        jersey_number: form.jersey_number === '' ? null : Number(form.jersey_number),
        position: form.position || null,
        status: form.status,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save'),
  })

  const remove = useMutation({
    mutationFn: async () => api.del(`players/${player.id}`),
    onSuccess: onRemoved,
  })

  return (
    <Sheet open={open} onClose={onClose} title="Edit player">
      <div className="space-y-4">
        <Field label="Name">
          <Input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Shirt number">
            <Input
              type="number"
              min={0}
              max={99}
              value={form.jersey_number}
              onChange={(e) => setForm({ ...form, jersey_number: e.target.value })}
              placeholder="—"
            />
          </Field>
          <Field label="Position">
            <PositionSelect
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </Field>
        </div>

        <Field label="WhatsApp nickname" hint="Optional — the name they go by in the group chat">
          <Input
            value={form.whatsapp_nickname}
            onChange={(e) => setForm({ ...form, whatsapp_nickname: e.target.value })}
          />
        </Field>

        <Field label="Status" hint="Guests can be kept off the league table in settings">
          <Select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Player['status'] })}
          >
            <option value="active">Regular player</option>
            <option value="guest">Guest</option>
          </Select>
        </Field>

        {error && <p className="text-[14px] text-card-red">{error}</p>}

        <Button size="lg" fullWidth loading={save.isPending} onClick={() => save.mutate()}>
          Save changes
        </Button>

        {confirmRemove ? (
          <div className="rounded-xl border border-card-red/40 bg-card-red/5 p-3.5">
            <p className="text-[14px] text-chalk">
              Remove {player.display_name} from the squad? Their past goals and stats stay in the
              record.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="danger" fullWidth loading={remove.isPending} onClick={() => remove.mutate()}>
                Yes, remove
              </Button>
              <Button variant="ghost" fullWidth onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" fullWidth onClick={() => setConfirmRemove(true)}>
            Remove from squad
          </Button>
        )}
      </div>
    </Sheet>
  )
}
