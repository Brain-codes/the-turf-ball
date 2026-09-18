/**
 * Storage — the task manager for a group's storage accounts (Cloudinary,
 * ImageKit, Cloudflare R2, Backblaze B2, Bunny.net).
 *
 * One screen, two homes: the team sees it for their own group inside the
 * gallery, and the super admin sees exactly the same screen for any group.
 * What each person can change comes from the server (can_manage / super_admin).
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowRightLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiHardDrive3Line,
  RiPauseLine,
  RiPencilLine,
  RiPlayLine,
  RiRefreshLine,
  RiShieldKeyholeLine,
} from '@remixicon/react'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Badge, Button, ErrorState, Skeleton, Toggle } from '@/components/ui'
import { motion, Stagger, StaggerItem } from '@/components/motion'
import { relative, fullDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { formatBytes } from '../shared/media'
import type { StorageAccount, StorageView } from '../types'
import { AccountSheet } from './AccountSheet'

const storageKey = (orgId: string) => ['gallery', 'storage', orgId]

const STATUS: Record<StorageAccount['status'], { label: string; tone: 'volt' | 'neutral' | 'warn' | 'danger'; hint: string }> = {
  active: { label: 'Taking uploads', tone: 'volt', hint: 'New uploads are going here.' },
  filling: { label: 'Almost full', tone: 'warn', hint: 'Still taking uploads, but close to its limit. The next account takes over soon.' },
  standby: { label: 'Standby', tone: 'neutral', hint: 'Waiting its turn. Takes over when the ones above fill up.' },
  full: { label: 'Full', tone: 'danger', hint: 'Past its limit. No new uploads go here; existing files still show. Views and edits count over the last 30 days, so as they fall off it can start taking uploads again.' },
  disabled: { label: 'Paused', tone: 'neutral', hint: 'Skipped for new uploads. Existing files still show.' },
  error: { label: 'Keys not working', tone: 'danger', hint: 'Cloudinary rejected the keys. Edit the account and paste them again.' },
}

export function StoragePanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const { refresh } = useAuth()
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'edit'; account: StorageAccount } | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: storageKey(orgId),
    queryFn: async () => (await api.get<StorageView>(`gallery/storage/${orgId}`)).data,
  })

  const done = (text: string) => {
    setNotice({ tone: 'ok', text })
    qc.invalidateQueries({ queryKey: ['gallery'] })
    qc.invalidateQueries({ queryKey: ['admin', 'storage'] })
  }
  const fail = (e: Error) => setNotice({ tone: 'bad', text: e.message })

  const refreshAll = useMutation({ mutationFn: () => api.post(`gallery/storage/${orgId}/refresh`), onSuccess: () => done('Usage updated from Cloudinary'), onError: fail })
  const refreshOne = useMutation({ mutationFn: (id: string) => api.post(`gallery/storage/${orgId}/accounts/${id}/refresh`), onSuccess: () => done('Usage updated'), onError: fail })
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`gallery/storage/${orgId}/accounts/${id}`, body),
    onSuccess: (r) => done(r.message),
    onError: fail,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`gallery/storage/${orgId}/accounts/${id}`), onSuccess: (r) => done(r.message), onError: fail })
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.post(`gallery/storage/${orgId}/reorder`, { ids }), onSuccess: () => done('Order saved'), onError: fail })
  const settings = useMutation({
    mutationFn: (gallery_enabled: boolean) => api.patch(`gallery/storage/${orgId}/settings`, { gallery_enabled }),
    onSuccess: (r) => {
      done(r.message)
      // The nav reads gallery_enabled from /me.
      void refresh()
    },
    onError: fail,
  })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? 'Could not load storage'} onRetry={() => refetch()} />

  const { accounts, totals, can_manage: canManage } = data
  const move = (i: number, d: -1 | 1) => {
    const ids = accounts.map((a) => a.id)
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    reorder.mutate(ids)
  }
  const anyTaking = accounts.some((a) => a.taking_uploads)

  return (
    <div className="space-y-6">
      {data.super_admin && (
        <div className="surface px-5 py-2">
          <Toggle
            checked={data.organization.gallery_enabled}
            disabled={settings.isPending}
            onChange={(v) => settings.mutate(v)}
            label={`Gallery for ${data.organization.name}`}
            description={data.organization.gallery_enabled
              ? `On. Members can upload, and the public gallery is at /g/${data.organization.slug}.`
              : 'Off. Nobody in this group can upload, and the public gallery is hidden.'}
          />
        </div>
      )}

      {notice && (
        <p role={notice.tone === 'bad' ? 'alert' : 'status'} className={cn('rounded-xl px-4 py-3 text-[14px]', notice.tone === 'bad' ? 'bg-card-red/10 text-card-red' : 'bg-turf-500/15 text-turf-400')}>
          {notice.text}
        </p>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Total label="Files" value={totals.files.toLocaleString()} sub={`${totals.images.toLocaleString()} photos · ${totals.videos.toLocaleString()} videos`} />
        <Total label="Space used by files" value={formatBytes(totals.bytes)} sub={`across ${totals.accounts} account${totals.accounts === 1 ? '' : 's'}`} />
        <Total
          label="In the trash"
          value={formatBytes(totals.trash_bytes)}
          sub={totals.trash_files ? `${totals.trash_files} file${totals.trash_files === 1 ? '' : 's'} · next clear-out ${fullDate(totals.next_purge_at!)}` : 'Empty'}
        />
        <Total
          label="Uploads going to"
          value={goingTo(accounts, 'image') === goingTo(accounts, 'video') ? goingTo(accounts, 'image') : `${goingTo(accounts, 'image')} / ${goingTo(accounts, 'video')}`}
          sub={goingTo(accounts, 'image') === goingTo(accounts, 'video') ? 'photos and videos' : 'photos / videos'}
          alert={!anyTaking}
        />
      </div>

      {/* Fill order */}
      {accounts.length > 1 && (
        <div className="surface px-5 py-4">
          <p className="text-[13px] text-chalk-muted">Uploads fill accounts in this order. When one reaches its limit, the next takes over.</p>
          <ol className="mt-3 flex flex-wrap items-center gap-2">
            {accounts.map((a, i) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className={cn(
                  'rounded-full px-3 py-1 text-[13px] font-medium',
                  a.taking_uploads ? 'bg-volt-400 text-void' : a.status === 'full' ? 'bg-card-red/15 text-card-red line-through' : 'bg-pitch-700 text-chalk-muted',
                )}>
                  {i + 1}. {a.label}
                </span>
                {i < accounts.length - 1 && <RiArrowRightLine aria-hidden className="h-4 w-4 text-chalk-faint" />}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Accounts */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg">Storage accounts</h2>
        <div className="flex gap-2">
          {accounts.length > 0 && (
            <Button variant="secondary" size="sm" loading={refreshAll.isPending} onClick={() => refreshAll.mutate()}>
              <RiRefreshLine className="h-4 w-4" /> Refresh all
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => setSheet({ mode: 'add' })}>
              <RiAddLine className="h-4 w-4" /> Add account
            </Button>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="surface flex flex-col items-center px-6 py-14 text-center">
          <RiHardDrive3Line className="h-10 w-10 text-chalk-faint" />
          <h3 className="mt-4 text-lg">No storage yet</h3>
          <p className="mt-1.5 max-w-sm text-[14px] text-chalk-muted">
            Each person in the group can bring their own account — Cloudinary, ImageKit, Cloudflare R2, Backblaze B2 or Bunny.net — and add it here. When one fills up, uploads move to the next automatically.
          </p>
          {canManage && <Button className="mt-5" onClick={() => setSheet({ mode: 'add' })}><RiAddLine className="h-4 w-4" /> Add the first account</Button>}
        </div>
      ) : (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          {accounts.map((a, i) => (
            <StaggerItem key={a.id}>
              <AccountCard
                account={a}
                index={i}
                canManage={canManage}
                first={i === 0}
                last={i === accounts.length - 1}
                busy={patch.isPending || reorder.isPending || remove.isPending}
                refreshing={refreshOne.isPending && refreshOne.variables === a.id}
                onRefresh={() => refreshOne.mutate(a.id)}
                onMove={(d) => move(i, d)}
                onPause={() => patch.mutate({ id: a.id, body: { enabled: !a.enabled } })}
                onEdit={() => setSheet({ mode: 'edit', account: a })}
                onRemove={() => {
                  if (window.confirm(`Remove “${a.label}” from this group? The keys are deleted from The Turf Ball. Nothing on Cloudinary is touched.`)) remove.mutate(a.id)
                }}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <SecurityNote />

      <AccountSheet
        orgId={orgId}
        state={sheet}
        onClose={() => setSheet(null)}
        onSaved={(msg) => {
          setSheet(null)
          done(msg)
        }}
      />
    </div>
  )
}

function Total({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className={cn('surface px-4 py-4', alert && 'border-card-red/40')}>
      <p className="text-[12px] font-medium uppercase tracking-wider text-chalk-faint">{label}</p>
      <p className={cn('mt-1.5 truncate font-display text-[22px] font-bold tabular', alert && 'text-card-red')}>{value}</p>
      <p className="mt-0.5 truncate text-[12.5px] text-chalk-muted">{sub}</p>
    </div>
  )
}

function AccountCard({
  account: a,
  index,
  canManage,
  first,
  last,
  busy,
  refreshing,
  onRefresh,
  onMove,
  onPause,
  onEdit,
  onRemove,
}: {
  account: StorageAccount
  index: number
  canManage: boolean
  first: boolean
  last: boolean
  busy: boolean
  refreshing: boolean
  onRefresh: () => void
  onMove: (d: -1 | 1) => void
  onPause: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const s = STATUS[a.status]
  const pct = Math.min(100, a.effective_pct)
  const barTone =
    a.status === 'error' || pct >= a.threshold_pct ? 'bg-card-red'
    : pct >= a.threshold_pct - 10 ? 'bg-card-yellow'
    : 'bg-volt-400'

  return (
    <article className={cn('surface relative overflow-hidden p-5', a.taking_uploads && 'border-volt-400/40')} aria-label={`${a.label}, ${s.label}`}>
      {a.taking_uploads && <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-volt-400/10 blur-3xl" />}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] tabular text-chalk-faint">#{index + 1}</p>
          <h3 className="truncate text-[17px]">{a.label}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="rounded-full bg-pitch-700 px-2 py-0.5 font-medium text-chalk">{a.provider_name}</span>
            {a.kinds.length === 1 && <span className="rounded-full bg-pitch-700 px-2 py-0.5 text-chalk-muted">Videos only</span>}
          </p>
          <p className="mt-1 truncate text-[12.5px] text-chalk-muted">{a.cloud_name} · key {a.api_key} · secret ••••{a.secret_last4}</p>
        </div>
        <Badge tone={s.tone} className="shrink-0">{s.label}</Badge>
      </header>

      {/* Gauge */}
      <div className="mt-5">
        <div className="flex items-end justify-between">
          <span className="font-numeric text-[44px] leading-none tabular">{a.status === 'error' || !hasLimit(a) ? '—' : `${Math.round(pct)}%`}</span>
          <span className="pb-1 text-right text-[12.5px] text-chalk-muted">
            {limitLine(a)}
            {hasLimit(a) && <><br />switches at {Number(a.threshold_pct)}%</>}
          </span>
        </div>
        <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-pitch-700" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Plan used">
          <motion.div
            className={cn('h-full origin-left rounded-full', barTone)}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: pct / 100 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
          <span aria-hidden className="absolute inset-y-0 w-0.5 bg-chalk/70" style={{ left: `${a.threshold_pct}%` }} />
        </div>
        <p className="mt-2 text-[12.5px] text-chalk-muted">{a.last_error && a.status === 'error' ? a.last_error : s.hint}</p>
      </div>

      {/* Numbers */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-pitch-700 pt-4 text-[13px] sm:grid-cols-4">
        <Metric label="Stored" value={formatBytes(a.storage_bytes)} />
        <Metric
          label="Views & downloads, 30 days"
          value={a.provider === 'r2' ? 'Free' : a.bandwidth_bytes == null ? 'Not reported' : formatBytes(a.bandwidth_bytes)}
        />
        <Metric label="Our files" value={`${a.files.toLocaleString()}`} sub={`${a.images} photos · ${a.videos} videos`} />
        {a.provider === 'cloudinary'
          ? <Metric label="Edits, 30 days" value={(a.transformations ?? 0).toLocaleString()} />
          : <Metric label="Allowance" value={a.storage_limit_bytes ? formatBytes(a.storage_limit_bytes) : 'No limit'} sub={a.bandwidth_limit_bytes ? `${formatBytes(a.bandwidth_limit_bytes)} bandwidth` : undefined} />}
      </dl>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-pitch-700 pt-3">
        <span className="text-[12px] text-chalk-faint">{a.last_checked_at ? `Checked ${relative(a.last_checked_at)}` : 'Not checked yet'}</span>
        <div className="flex flex-wrap gap-1">
          <IconAction label="Refresh usage" onClick={onRefresh} busy={refreshing}><RiRefreshLine /></IconAction>
          {canManage && (
            <>
              <IconAction label="Move up the order" onClick={() => onMove(-1)} disabled={first || busy}><RiArrowUpLine /></IconAction>
              <IconAction label="Move down the order" onClick={() => onMove(1)} disabled={last || busy}><RiArrowDownLine /></IconAction>
              <IconAction label={a.enabled ? 'Pause uploads to this account' : 'Resume uploads to this account'} onClick={onPause} disabled={busy}>
                {a.enabled ? <RiPauseLine /> : <RiPlayLine />}
              </IconAction>
              <IconAction label="Edit account" onClick={onEdit}><RiPencilLine /></IconAction>
              <IconAction label="Remove account" onClick={onRemove} disabled={busy} danger><RiDeleteBinLine /></IconAction>
            </>
          )}
        </div>
      </footer>
    </article>
  )
}

const goingTo = (accounts: StorageAccount[], kind: 'image' | 'video') =>
  accounts.find((a) => a.takes?.includes(kind))?.label ?? 'Nowhere'

const hasLimit = (a: StorageAccount) => !!(a.credits_limit || a.storage_limit_bytes || a.bandwidth_limit_bytes)

function limitLine(a: StorageAccount): string {
  if (a.credits_limit) return `${Number(a.credits_used ?? 0).toFixed(2)} of ${a.credits_limit} credits`
  if (a.storage_limit_bytes) return `${formatBytes(a.storage_bytes)} of ${formatBytes(a.storage_limit_bytes)} stored`
  return 'No limit — pay as you go'
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11.5px] text-chalk-faint">{label}</dt>
      <dd className="truncate font-medium tabular text-chalk">{value}</dd>
      {sub && <dd className="truncate text-[11.5px] text-chalk-muted">{sub}</dd>}
    </div>
  )
}

function IconAction({ label, onClick, disabled, busy, danger, children }: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-chalk-muted transition-colors hover:bg-pitch-800 hover:text-chalk disabled:cursor-not-allowed disabled:opacity-35 [&>svg]:h-[18px] [&>svg]:w-[18px]',
        danger && 'hover:text-card-red',
        busy && '[&>svg]:animate-spin',
      )}
    >
      {children}
    </button>
  )
}

function SecurityNote() {
  const [open, setOpen] = useState(false)
  return (
    <div className="surface px-5 py-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 text-left text-[14px] text-chalk">
        <RiShieldKeyholeLine className="h-5 w-5 text-volt-400" />
        How are the keys kept safe?
        <span className="ml-auto text-[13px] text-chalk-muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-[13.5px] leading-relaxed text-chalk-muted">
          <li>The API secret is checked with Cloudinary, then locked with AES-256 encryption before it's saved. The unlocking key lives in a separate server setting, not in the database.</li>
          <li>Nobody can read the secret back — not the team, not the super admin. This screen only ever shows its last four characters.</li>
          <li>Phones never get the secret. Each upload gets a one-file pass that expires within an hour and can't delete or list anything.</li>
          <li>Each free Cloudinary account gives 25 credits a month: 1 GB stored, 1 GB viewed or downloaded, or 1,000 edits each cost 1 credit. Stored files stay counted; views and edits only count for the last 30 days.</li>
          <li>Deleting, compressing and downloading in bulk all happen on our server, after checking the person's role.</li>
        </ul>
      )}
    </div>
  )
}
