/**
 * The design-system primitives. Built once, reused everywhere. SPEC.md §14.4.
 *
 * Every surface here assumes a near-black background: elevation comes from
 * layered surfaces and glow, never from grey drop shadows, which are invisible
 * on #050706.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'
import { initials, POSITION_GROUPS, POSITION_LABEL } from '@/lib/format'

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-volt-400 text-void font-semibold hover:bg-volt-300 active:scale-[0.98] disabled:bg-pitch-700 disabled:text-chalk-faint',
  secondary:
    'bg-pitch-800 text-chalk border border-pitch-700 hover:border-pitch-600 hover:bg-pitch-700 active:scale-[0.98]',
  ghost: 'text-chalk-muted hover:text-chalk hover:bg-pitch-800',
  danger: 'bg-card-red/15 text-card-red border border-card-red/40 hover:bg-card-red/25',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg',
  md: 'h-11 px-4 text-[15px] rounded-lg',
  lg: 'h-13 px-6 text-base rounded-xl',
  xl: 'h-16 px-8 text-lg rounded-2xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition-all duration-150 select-none',
        'disabled:cursor-not-allowed disabled:opacity-70',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      aria-hidden
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('surface p-4', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-chalk-muted">
        {children}
      </h2>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                       */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  accent,
  className,
}: {
  label: string
  value: ReactNode
  accent?: boolean
  className?: string
}) {
  return (
    <div className={cn('surface px-3 py-3.5 text-center', className)}>
      <div
        className={cn(
          'numeric text-3xl leading-none',
          accent ? 'text-volt-400' : 'text-chalk',
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wider text-chalk-muted">{label}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Player identity                                                             */
/* -------------------------------------------------------------------------- */

const AVATAR_SIZES = { xs: 'h-7 w-7 text-[10px]', sm: 'h-9 w-9 text-xs', md: 'h-11 w-11 text-sm', lg: 'h-16 w-16 text-lg', xl: 'h-24 w-24 text-2xl' }

export function PlayerAvatar({
  name,
  photoUrl,
  size = 'md',
  className,
}: {
  name: string
  photoUrl?: string | null
  size?: keyof typeof AVATAR_SIZES
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-pitch-700 font-semibold text-chalk-muted',
        AVATAR_SIZES[size],
        className,
      )}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials(name)
      )}
    </div>
  )
}

/**
 * A lot of people at the pitch know each other by WhatsApp name, not the
 * name on the roster — this shows both, the nickname small and faint so it
 * reads as a hint, not a second identity. Nothing renders if there's no
 * nickname or it's identical to the display name (redundant either way).
 */
export function PlayerName({
  name,
  whatsappNickname,
  className,
  nicknameClassName,
}: {
  name: string
  whatsappNickname?: string | null
  className?: string
  nicknameClassName?: string
}) {
  const showNickname = whatsappNickname && whatsappNickname.trim() && whatsappNickname.trim() !== name.trim()
  return (
    <span className={cn('min-w-0 truncate', className)}>
      {name}
      {showNickname && (
        <span className={cn('ml-1.5 text-[11px] font-normal text-chalk-faint/70', nicknameClassName)}>
          ({whatsappNickname})
        </span>
      )}
    </span>
  )
}

export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  // Only the podium gets colour. If every rank were highlighted, none would be.
  const tone =
    rank === 1
      ? 'bg-volt-400 text-void'
      : rank === 2
        ? 'bg-pitch-600 text-chalk'
        : rank === 3
          ? 'bg-pitch-700 text-chalk'
          : 'bg-transparent text-chalk-faint'

  return (
    <span
      className={cn(
        'numeric flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm',
        tone,
        className,
      )}
    >
      {rank}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */

interface FieldProps {
  label?: string
  error?: string
  hint?: string
  children: ReactNode
}

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-medium text-chalk-muted">{label}</span>
      )}
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] text-card-red">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-chalk-faint">{hint}</span>
      ) : null}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-11 w-full rounded-lg border bg-pitch-900 px-3.5 text-[16px] text-chalk',
          'placeholder:text-chalk-faint focus:outline-none',
          invalid ? 'border-card-red' : 'border-pitch-700 focus:border-turf-400',
          className,
        )}
        {...rest}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-11 w-full appearance-none rounded-lg border border-pitch-700 bg-pitch-900 px-3.5 text-[16px] text-chalk',
          'focus:border-turf-400 focus:outline-none',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    )
  },
)

/** A position <select> grouped GK/Defence/Midfield/Attack, real position codes (RB, CDM, CAM…). */
export const PositionSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function PositionSelect({ children, ...rest }, ref) {
    return (
      <Select ref={ref} {...rest}>
        {children ?? <option value="">Not set</option>}
        {POSITION_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((code) => (
              <option key={code} value={code}>{POSITION_LABEL[code]} ({code})</option>
            ))}
          </optgroup>
        ))}
      </Select>
    )
  },
)

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[15px] text-chalk">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[13px] text-chalk-muted">{description}</span>
        )}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-volt-400' : 'bg-pitch-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-void transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-pitch-800', className)} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 text-4xl opacity-60">{icon}</div>}
      <h3 className="text-lg text-chalk">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-chalk-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="⚠️"
      title="That didn't load"
      description={message}
      action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    />
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'volt' | 'live' | 'warn' | 'danger'
  className?: string
}) {
  const tones = {
    neutral: 'bg-pitch-700 text-chalk-muted',
    volt: 'bg-volt-400/15 text-volt-400',
    live: 'bg-card-red/20 text-card-red',
    warn: 'bg-card-yellow/15 text-card-yellow',
    danger: 'bg-card-red/15 text-card-red',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
