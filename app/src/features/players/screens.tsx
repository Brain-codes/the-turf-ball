import { useEffect, useMemo, useState } from 'react'
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
import { findLikelyDuplicates } from '@/lib/similarity'
import type { Award, Player, PlayerStats } from '@/types'

/* -------------------------------------------------------------------------- */
/* Squad list                                                                  */
/* -------------------------------------------------------------------------- */

export function PlayersScreen() {
  const { activeOrg } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergePair, setMergePair] = useState<{ keep: Player; duplicate: Player } | null>(null)
  const [mergeDuplicatePreset, setMergeDuplicatePreset] = useState<Player | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set())

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

  const joinLink = activeOrg ? `${window.location.origin}/play/${activeOrg.slug}` : null

  // Self-serve joins mean the same person can end up submitting twice under
  // a slightly different spelling — flag near-identical names so the
  // organizer can review and merge instead of noticing by accident. This
  // checks both within the active squad AND a pending resubmission against
  // someone already in the squad — that second case is the common one: they
  // forget they already joined and fill the link in again.
  const duplicateSuggestions = useMemo(
    () =>
      findLikelyDuplicates([...(data ?? []), ...(pending ?? [])], (p) => p.display_name).filter(
        ([a, b]) => !dismissedSuggestions.has([a.id, b.id].sort().join(':')),
      ),
    [data, pending, dismissedSuggestions],
  )

  /** A pending resubmission is always the duplicate; otherwise the older signup is kept. */
  function orderKeepDuplicate(a: Player, b: Player): [Player, Player] {
    if (a.status === 'pending' && b.status !== 'pending') return [b, a]
    if (b.status === 'pending' && a.status !== 'pending') return [a, b]
    return new Date(a.joined_at) <= new Date(b.joined_at) ? [a, b] : [b, a]
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Squad"
        subtitle={data ? `${data.length} player${data.length === 1 ? '' : 's'}` : undefined}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMergeOpen(true)}>
              Merge
            </Button>
            <Button onClick={() => setAddOpen(true)}>Add</Button>
          </div>
        }
      />

      {joinLink && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 rounded-xl border border-pitch-700 bg-pitch-900 py-2 pl-3 pr-1.5">
            <span className="shrink-0 text-[12px] font-medium text-chalk-faint">Squad link</span>
            <p className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-volt-400">{joinLink}</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(joinLink)
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 2000)
              }}
            >
              {linkCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {duplicateSuggestions.length > 0 && (
        <div className="px-5 pb-5">
          <SectionTitle>Possible duplicates ({duplicateSuggestions.length})</SectionTitle>
          <Card className="mt-2 divide-y divide-pitch-700 !p-0">
            {duplicateSuggestions.map(([a, b]) => {
              const key = [a.id, b.id].sort().join(':')
              return (
                <div key={key} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <PlayerAvatar name={a.display_name} photoUrl={a.photo_url} size="sm" />
                    <span className="truncate text-[13.5px] text-chalk">{a.display_name}</span>
                    {a.status === 'pending' && <Badge tone="warn">Pending</Badge>}
                    <span className="text-chalk-faint">/</span>
                    <PlayerAvatar name={b.display_name} photoUrl={b.photo_url} size="sm" />
                    <span className="truncate text-[13.5px] text-chalk">{b.display_name}</span>
                    {b.status === 'pending' && <Badge tone="warn">Pending</Badge>}
                  </div>
                  <button
                    onClick={() => setDismissedSuggestions((prev) => new Set(prev).add(key))}
                    className="shrink-0 text-[12.5px] text-chalk-muted"
                  >
                    Not a duplicate
                  </button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const [keep, duplicate] = orderKeepDuplicate(a, b)
                      setMergePair({ keep, duplicate })
                      setMergeOpen(true)
                    }}
                  >
                    Review
                  </Button>
                </div>
              )
            })}
          </Card>
        </div>
      )}

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
                <button
                  onClick={() => { setMergeDuplicatePreset(p); setMergeOpen(true) }}
                  className="shrink-0 text-[12.5px] text-chalk-muted"
                >
                  Already in squad?
                </button>
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

      <MergePlayersSheet
        open={mergeOpen}
        players={[...(data ?? []), ...(pending ?? [])]}
        initialPair={mergePair}
        presetDuplicate={mergeDuplicatePreset}
        onClose={() => { setMergeOpen(false); setMergePair(null); setMergeDuplicatePreset(null) }}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ['players'] })
          queryClient.invalidateQueries({ queryKey: ['players-pending'] })
          setMergeOpen(false)
          setMergePair(null)
          setMergeDuplicatePreset(null)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Merge duplicates — pick the profile to keep, the duplicate to fold in, and */
/* which categories of history move over. Whatever's left unchecked stays on */
/* the duplicate, which is archived rather than deleted.                     */
/* -------------------------------------------------------------------------- */

const MERGE_CATEGORIES = [
  { value: 'goal', label: 'Goals' },
  { value: 'assist', label: 'Assists' },
  { value: 'own_goal', label: 'Own goals' },
  { value: 'yellow_card', label: 'Yellow cards' },
  { value: 'red_card', label: 'Red cards' },
  { value: 'attendance', label: 'Attendance / appearances' },
] as const

/** Profile fields worth reconciling when two rows for the same person differ. */
const MERGE_FIELDS = [
  { key: 'display_name', label: 'Name' },
  { key: 'jersey_number', label: 'Shirt number' },
  { key: 'position', label: 'Position' },
  { key: 'preferred_foot', label: 'Preferred foot' },
  { key: 'whatsapp_nickname', label: 'WhatsApp nickname' },
  { key: 'photo_url', label: 'Photo' },
] as const
type MergeFieldKey = (typeof MERGE_FIELDS)[number]['key']

function fieldDisplay(p: Player, key: MergeFieldKey): string {
  const v = p[key]
  if (key === 'jersey_number') return v !== null && v !== undefined ? `#${v}` : 'No number'
  if (key === 'position') return v ? POSITION_LABEL[v as keyof typeof POSITION_LABEL] : 'Not set'
  if (key === 'preferred_foot') return v ? `${(v as string)[0].toUpperCase()}${(v as string).slice(1)}` : 'Not set'
  if (key === 'photo_url') return v ? 'Has a photo' : 'No photo'
  return (v as string | null) || 'Not set'
}

function MergePlayersSheet({
  open,
  players,
  initialPair,
  presetDuplicate,
  onClose,
  onDone,
}: {
  open: boolean
  players: Player[]
  initialPair?: { keep: Player; duplicate: Player } | null
  presetDuplicate?: Player | null
  onClose: () => void
  onDone: () => void
}) {
  const [step, setStep] = useState<'keep' | 'duplicate' | 'fields' | 'categories'>('keep')
  const [keep, setKeep] = useState<Player | null>(null)
  const [duplicate, setDuplicate] = useState<Player | null>(null)
  const [fieldChoices, setFieldChoices] = useState<Record<string, 'keep' | 'duplicate'>>({})
  const [categories, setCategories] = useState<Set<string>>(
    new Set(MERGE_CATEGORIES.map((c) => c.value)),
  )
  const [deleteDuplicate, setDeleteDuplicate] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep('keep')
    setKeep(null)
    setDuplicate(null)
    setFieldChoices({})
    setCategories(new Set(MERGE_CATEGORIES.map((c) => c.value)))
    setDeleteDuplicate(false)
    setSearch('')
    setError(null)
  }

  // A suggestion from "possible duplicates" arrives with both players
  // already picked — skip straight past the two search steps. "Already in
  // squad?" on a pending row arrives with only the duplicate fixed — the
  // organizer still needs to search for who they're the same person as.
  useEffect(() => {
    if (!open) return
    if (initialPair) {
      setKeep(initialPair.keep)
      setDuplicate(initialPair.duplicate)
      setFieldChoices({})
      setStep('fields')
    } else if (presetDuplicate) {
      setDuplicate(presetDuplicate)
      setKeep(null)
      setFieldChoices({})
      setStep('keep')
    }
  }, [open, initialPair, presetDuplicate])

  // A pending signup has no attendance or events yet (they can't exist
  // before approval), so there's nothing to move — skip the category
  // checklist and just fold it in, then remove it from the queue.
  const duplicateIsPending = duplicate?.status === 'pending'

  useEffect(() => {
    if (!duplicate) return
    if (duplicateIsPending) {
      setCategories(new Set())
      setDeleteDuplicate(true)
    } else {
      setCategories(new Set(MERGE_CATEGORIES.map((c) => c.value)))
      setDeleteDuplicate(false)
    }
  }, [duplicateIsPending, duplicate?.id])

  const diffFields = useMemo(() => {
    if (!keep || !duplicate) return []
    return MERGE_FIELDS.filter((f) => fieldDisplay(keep, f.key) !== fieldDisplay(duplicate, f.key))
  }, [keep, duplicate])

  const merge = useMutation({
    mutationFn: async () => {
      if (!keep || !duplicate) return
      const field_overrides: Record<string, unknown> = {}
      for (const f of diffFields) {
        if (fieldChoices[f.key] === 'duplicate') field_overrides[f.key] = duplicate[f.key]
      }
      await api.post(`players/${keep.id}/merge`, {
        duplicate_player_id: duplicate.id,
        categories: Array.from(categories),
        delete_duplicate: deleteDuplicate,
        field_overrides,
      })
    },
    onSuccess: () => {
      reset()
      onDone()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not merge those players'),
  })

  function toggleCategory(value: string) {
    setCategories((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function goToNextAfterDuplicate(k: Player, d: Player) {
    const diffs = MERGE_FIELDS.filter((f) => fieldDisplay(k, f.key) !== fieldDisplay(d, f.key))
    setStep(diffs.length > 0 ? 'fields' : 'categories')
  }

  const excludeIds = new Set([keep?.id, duplicate?.id].filter((id): id is string => !!id))
  const candidates = players
    .filter((p) => !excludeIds.has(p.id))
    .filter((p) => p.display_name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <Sheet
      open={open}
      onClose={() => { reset(); onClose() }}
      title={
        step === 'keep'
          ? (duplicate ? `Who is ${duplicate.display_name} already in your squad as?` : 'Merge duplicates — keep which profile?')
          : step === 'duplicate' ? `Merge into ${keep?.display_name} — which is the duplicate?`
          : step === 'fields' ? 'Which details are right?'
          : duplicateIsPending ? 'Remove the duplicate signup'
          : 'What moves over?'
      }
    >
      {step === 'fields' && keep && duplicate ? (
        <>
          <p className="mb-4 text-[14px] text-chalk-muted">
            These profile details differ between the two — pick which one is correct.
          </p>
          <div className="mb-4 space-y-3">
            {diffFields.map((f) => {
              const choice = fieldChoices[f.key] ?? 'keep'
              return (
                <div key={f.key}>
                  <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-chalk-faint">
                    {f.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFieldChoices((prev) => ({ ...prev, [f.key]: 'keep' }))}
                      className={`rounded-xl border px-3 py-2.5 text-left text-[13.5px] ${choice === 'keep' ? 'border-volt-400 bg-volt-400/10 text-chalk' : 'border-pitch-700 bg-pitch-900 text-chalk-muted'}`}
                    >
                      {fieldDisplay(keep, f.key)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFieldChoices((prev) => ({ ...prev, [f.key]: 'duplicate' }))}
                      className={`rounded-xl border px-3 py-2.5 text-left text-[13.5px] ${choice === 'duplicate' ? 'border-volt-400 bg-volt-400/10 text-chalk' : 'border-pitch-700 bg-pitch-900 text-chalk-muted'}`}
                    >
                      {fieldDisplay(duplicate, f.key)}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" fullWidth onClick={() => setStep('duplicate')}>
              Back
            </Button>
            <Button fullWidth onClick={() => setStep('categories')}>
              Continue
            </Button>
          </div>
        </>
      ) : step === 'categories' && keep && duplicate && duplicateIsPending ? (
        <>
          <p className="mb-4 text-[14px] text-chalk-muted">
            <span className="font-medium text-chalk">{duplicate.display_name}</span>'s pending
            signup has no history yet — merging just applies the details you picked to{' '}
            <span className="font-medium text-chalk">{keep.display_name}</span> and removes the
            duplicate from your approval queue.
          </p>
          {error && <p className="mb-3 text-[14px] text-card-red">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setStep(diffFields.length > 0 ? 'fields' : 'duplicate')}
            >
              Back
            </Button>
            <Button fullWidth loading={merge.isPending} onClick={() => merge.mutate()}>
              Merge and remove
            </Button>
          </div>
        </>
      ) : step === 'categories' && keep && duplicate ? (
        <>
          <p className="mb-4 text-[14px] text-chalk-muted">
            <span className="font-medium text-chalk">{duplicate.display_name}</span> merges into{' '}
            <span className="font-medium text-chalk">{keep.display_name}</span>. Anything left
            unchecked stays behind on {duplicate.display_name}'s profile instead of moving.
          </p>
          <div className="mb-4 space-y-2">
            {MERGE_CATEGORIES.map((c) => {
              const checked = categories.has(c.value)
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleCategory(c.value)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-pitch-700 bg-pitch-900 px-3.5 py-3 text-left"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-volt-400 bg-volt-400 text-void' : 'border-pitch-600'}`}
                  >
                    {checked && '✓'}
                  </span>
                  <span className="text-[14px] text-chalk">{c.label}</span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => setDeleteDuplicate((v) => !v)}
            className="mb-2 flex w-full items-start gap-2.5 rounded-xl border border-pitch-700 bg-pitch-900 px-3.5 py-3 text-left"
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${deleteDuplicate ? 'border-card-red bg-card-red text-void' : 'border-pitch-600'}`}
            >
              {deleteDuplicate && '✓'}
            </span>
            <span>
              <span className="block text-[14px] text-chalk">
                Delete {duplicate.display_name}'s profile — they're the same person
              </span>
              <span className="block text-[12.5px] text-chalk-muted">
                {categories.size === MERGE_CATEGORIES.length
                  ? 'Everything above is being moved, so nothing is lost by removing the empty duplicate.'
                  : "Anything you left unchecked above is permanently deleted too — it won't stay behind."}
              </span>
            </span>
          </button>

          {error && <p className="mb-3 text-[14px] text-card-red">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setStep(diffFields.length > 0 ? 'fields' : 'duplicate')}
            >
              Back
            </Button>
            <Button fullWidth loading={merge.isPending} onClick={() => merge.mutate()}>
              {deleteDuplicate ? 'Merge and delete' : 'Merge'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players"
            className="mb-3"
            autoFocus
          />
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {candidates.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (step === 'keep') {
                    setKeep(p)
                    // A preset duplicate (from "Already in squad?" on a
                    // pending row) is already fixed — go straight on rather
                    // than asking who the duplicate is a second time.
                    if (duplicate) goToNextAfterDuplicate(p, duplicate)
                    else setStep('duplicate')
                  } else if (keep) {
                    setDuplicate(p)
                    goToNextAfterDuplicate(keep, p)
                  }
                  setSearch('')
                }}
                className="tap-target flex w-full items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-900 px-3.5 text-left"
              >
                <PlayerAvatar name={p.display_name} photoUrl={p.photo_url} size="sm" />
                <PlayerName
                  name={p.display_name}
                  whatsappNickname={p.whatsapp_nickname}
                  className="flex-1 text-[15px] text-chalk"
                />
              </button>
            ))}
            {candidates.length === 0 && (
              <p className="py-4 text-center text-[13.5px] text-chalk-faint">No players match</p>
            )}
          </div>
          {step === 'duplicate' && (
            <Button variant="ghost" fullWidth className="mt-3" onClick={() => setStep('keep')}>
              Back
            </Button>
          )}
        </>
      )}
    </Sheet>
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
        className="w-full resize-none rounded-xl border border-pitch-700 bg-pitch-900 p-3.5 text-[16px] leading-8 text-chalk placeholder:text-chalk-faint focus:border-turf-400 focus:outline-none"
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
