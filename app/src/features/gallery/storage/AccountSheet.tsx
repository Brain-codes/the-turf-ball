import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { RiArrowLeftLine, RiCheckLine, RiEyeLine, RiEyeOffLine, RiFileCopyLine, RiQuestionLine } from '@remixicon/react'
import { api, ApiError } from '@/services/client'
import { Button, Field, Input } from '@/components/ui'
import { Sheet } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { ProviderId, StorageAccount } from '../types'
import { PROVIDERS, providerInfo, type ProviderField } from './providers'

type SheetState = { mode: 'add' } | { mode: 'edit'; account: StorageAccount } | null

const GB = 1024 ** 3

/**
 * Add a storage account in two steps — pick the provider, then paste its
 * keys — or edit one (rename, limits, replace keys). Keys are checked with
 * the provider before anything is saved.
 */
export function AccountSheet({
  orgId,
  state,
  onClose,
  onSaved,
}: {
  orgId: string
  state: SheetState
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const editing = state?.mode === 'edit' ? state.account : null
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [label, setLabel] = useState('')
  const [threshold, setThreshold] = useState('95')
  const [storageGb, setStorageGb] = useState('')
  const [bandwidthGb, setBandwidthGb] = useState('')
  const [help, setHelp] = useState(true)

  useEffect(() => {
    if (!state) return
    setValues({})
    setHelp(!editing)
    if (editing) {
      setProvider(editing.provider)
      setLabel(editing.label)
      setThreshold(String(Number(editing.threshold_pct)))
      setStorageGb(editing.storage_limit_bytes ? String(+(editing.storage_limit_bytes / GB).toFixed(1)) : '')
      setBandwidthGb(editing.bandwidth_limit_bytes ? String(+(editing.bandwidth_limit_bytes / GB).toFixed(1)) : '')
    } else {
      setProvider(null)
      setLabel('')
      setThreshold('95')
    }
  }, [state, editing])

  const info = provider ? providerInfo(provider) : null

  // Fresh defaults when a provider is picked.
  const pick = (id: ProviderId) => {
    const p = providerInfo(id)
    setProvider(id)
    setValues({})
    setStorageGb(p.limits?.storage ? String(p.limits.storage) : '')
    setBandwidthGb(p.limits?.bandwidth ? String(p.limits.bandwidth) : '')
  }

  const save = useMutation({
    mutationFn: async () => {
      const p = info!
      const config: Record<string, string> = {}
      const secrets: Record<string, string> = {}
      for (const f of p.fields) {
        const v = values[f.key]?.trim()
        if (!v) continue
        if (f.secret) secrets[f.key] = v
        else config[f.key] = v
      }
      // Lets the server check the bucket's CORS rule against this site.
      const body: Record<string, unknown> = { label, threshold_pct: Number(threshold), origin: window.location.origin }
      if (p.limits) {
        body.storage_limit_gb = storageGb ? Number(storageGb) : null
        body.bandwidth_limit_gb = bandwidthGb ? Number(bandwidthGb) : null
      }
      if (editing) {
        if (Object.keys(secrets).length) Object.assign(body, { config, secrets })
        return api.patch(`gallery/storage/${orgId}/accounts/${editing.id}`, body)
      }
      return api.post(`gallery/storage/${orgId}/accounts`, { ...body, provider, config, secrets })
    },
    onSuccess: (r) => onSaved(r.message),
  })

  const err = save.error instanceof ApiError ? save.error : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const title = editing ? `Edit ${editing.label}` : info ? `Add ${info.name}` : 'Add storage'

  return (
    <Sheet open={!!state} onClose={onClose} title={title}>
      {!info ? (
        <ProviderPicker onPick={pick} />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!editing && (
            <button type="button" onClick={() => { setProvider(null); save.reset() }} className="-mt-2 flex min-h-11 cursor-pointer items-center gap-1.5 text-[14px] text-chalk-muted hover:text-chalk">
              <RiArrowLeftLine className="h-4 w-4" /> Choose a different service
            </button>
          )}

          {!editing && (
            <div className="rounded-xl bg-pitch-800 px-4 py-3">
              <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="flex w-full cursor-pointer items-center gap-2 text-left text-[13.5px] text-chalk">
                <RiQuestionLine className="h-4 w-4 text-volt-400" /> How to set up {info.name}
                <span className="ml-auto text-[12.5px] text-chalk-muted">{help ? 'Hide' : 'Show'}</span>
              </button>
              {help && (
                <>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-chalk-muted">
                    {info.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                  {info.snippet && <Snippet {...info.snippet(window.location.origin)} />}
                </>
              )}
            </div>
          )}

          <Field label="Name it" hint="Whose account is it? e.g. “Tunde’s R2”" error={err?.field('label')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} invalid={!!err?.field('label')} />
          </Field>

          {info.fields
            .filter((f) => !editing || f.secret || f.key === 'api_key' || f.key === 'access_key_id' || f.key === 'public_key')
            .map((f) => (
              <ProviderInput
                key={f.key}
                field={f}
                editing={!!editing}
                last4={editing?.secret_last4}
                value={values[f.key] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                error={err?.field(f.key)}
              />
            ))}

          {info.limits && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Storage allowance (GB)" hint={provider === 'bunny' ? 'Blank = no limit' : 'Leave blank for no limit'} error={err?.field('storage_limit_gb')}>
                <Input type="number" inputMode="decimal" min={0.1} step="any" value={storageGb} onChange={(e) => setStorageGb(e.target.value)} />
              </Field>
              {provider === 'imagekit' && (
                <Field label="Monthly bandwidth (GB)" error={err?.field('bandwidth_limit_gb')}>
                  <Input type="number" inputMode="decimal" min={0.1} step="any" value={bandwidthGb} onChange={(e) => setBandwidthGb(e.target.value)} />
                </Field>
              )}
            </div>
          )}

          {(provider !== 'bunny' || storageGb) && (
            <Field label="Move to the next account at" hint="When this account is this full, new uploads go to the next one." error={err?.field('threshold_pct')}>
              <div className="flex items-center gap-2">
                <Input type="number" inputMode="numeric" min={10} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-28" />
                <span className="text-chalk-muted">% full</span>
              </div>
            </Field>
          )}

          {save.error && !err?.fieldErrors && <p role="alert" className="text-[14px] text-card-red">{(save.error as Error).message}</p>}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} fullWidth>Cancel</Button>
            <Button type="submit" loading={save.isPending} disabled={!label.trim()} fullWidth>
              {save.isPending ? `Checking with ${info.name}…` : editing ? 'Save' : 'Connect'}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  )
}

function ProviderPicker({ onPick }: { onPick: (id: ProviderId) => void }) {
  return (
    <div>
      <p className="mb-3 text-[14px] text-chalk-muted">Which service is this account on? You can mix services — uploads fill them in the order you set.</p>
      <ul className="space-y-2">
        {PROVIDERS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id)}
              className="group flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-pitch-700 p-4 text-left transition-colors hover:border-volt-400/60 hover:bg-pitch-800/60 focus-visible:outline-2 focus-visible:outline-volt-400"
            >
              <span aria-hidden className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pitch-800 font-display text-[15px] font-bold text-volt-400 group-hover:bg-pitch-700">
                {p.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[15.5px] font-semibold text-chalk">{p.name}</span>
                  <span className="rounded-full bg-pitch-700 px-2 py-0.5 text-[11px] font-medium text-chalk-muted">{p.kinds.length === 1 ? 'Videos only' : 'Photos & videos'}</span>
                </span>
                <span className="mt-1 block text-[13px] leading-relaxed text-chalk-muted">{p.tagline}</span>
                <span className="mt-1 block text-[12.5px] font-medium text-turf-400">{p.free}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProviderInput({ field: f, editing, last4, value, onChange, error }: {
  field: ProviderField
  editing: boolean
  last4?: string
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  const [show, setShow] = useState(false)
  const label = editing ? `New ${f.label.toLowerCase()} (optional)` : f.label
  const hint = f.secret
    ? editing ? `Current one ends in ${last4}. Leave blank to keep it.` : 'Locked away as soon as you save. Nobody can read it back.'
    : f.hint

  return (
    <Field label={label} hint={hint} error={error}>
      <div className="relative">
        <Input
          type={f.secret && !show ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
          inputMode={f.numeric ? 'numeric' : undefined}
          autoComplete={f.secret ? 'new-password' : 'off'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={f.secret ? 'pr-12' : undefined}
          invalid={!!error}
        />
        {f.secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? `Hide ${f.label}` : `Show ${f.label}`}
            className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center text-chalk-muted hover:text-chalk"
          >
            {show ? <RiEyeOffLine className="h-5 w-5" /> : <RiEyeLine className="h-5 w-5" />}
          </button>
        )}
      </div>
    </Field>
  )
}

function Snippet({ title, body }: { title: string; body: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-chalk">{title}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
          className={cn('flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-[12.5px]', copied ? 'text-turf-400' : 'text-chalk-muted hover:text-chalk')}
        >
          {copied ? <RiCheckLine className="h-4 w-4" /> : <RiFileCopyLine className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto rounded-lg bg-void p-3 font-mono text-[11.5px] leading-relaxed text-chalk-muted">{body}</pre>
    </div>
  )
}
