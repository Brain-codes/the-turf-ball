import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getSupabase } from '@/lib/supabase'
import { api, ApiError } from '@/services/client'
import { useAuth } from './AuthProvider'
import { Button, Field, Input } from '@/components/ui'
import { FadeIn } from '@/components/motion'

function AuthShell({ title, subtitle, children, footer }: {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="pitch-lines flex min-h-dvh flex-col justify-center px-5 py-10">
      <FadeIn className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">⚽</div>
          <h1 className="text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-chalk-muted">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-6 text-center text-[14px] text-chalk-muted">{footer}</div>}
      </FadeIn>
    </div>
  )
}

function useFormError() {
  const [error, setError] = useState<ApiError | Error | null>(null)
  const fieldError = (name: string) =>
    error instanceof ApiError ? error.field(name) : undefined
  return { error, setError, fieldError }
}

export function LoginScreen() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, setError } = useFormError()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    // rule2.txt §11: simple login goes straight through Supabase Auth.
    const supabase = await getSupabase()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (authError) {
      setError(
        new Error(
          authError.message.toLowerCase().includes('confirm')
            ? 'Please confirm your email address first — check your inbox.'
            : 'That email and password do not match.',
        ),
      )
      setBusy(false)
      return
    }

    await refresh()
    navigate('/app', { replace: true })
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your football group"
      footer={<>New here? <Link to="/register" className="text-volt-400">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        {error && <p className="text-[14px] text-card-red">{error.message}</p>}
        <Button type="submit" size="lg" fullWidth loading={busy}>Sign in</Button>
        <div className="text-center">
          <Link to="/forgot-password" className="text-[14px] text-chalk-muted hover:text-chalk">Forgot your password?</Link>
        </div>
      </form>
    </AuthShell>
  )
}

export function RegisterScreen() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const { error, setError, fieldError } = useFormError()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Compound signup (auth user + profile + pending invites) goes through
      // the Edge Function — rule2.txt §12.
      await api.post('auth/register', form)
      navigate(`/verify-email?email=${encodeURIComponent(form.email)}`, { replace: true })
    } catch (err) {
      setError(err as ApiError)
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <AuthShell
      title="Start your group"
      subtitle="Track goals, assists and Player of the Month"
      footer={<>Already have an account? <Link to="/login" className="text-volt-400">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name" error={fieldError('full_name')}>
          <Input value={form.full_name} onChange={set('full_name')} required autoComplete="name" placeholder="Ade Johnson" invalid={!!fieldError('full_name')} />
        </Field>
        <Field label="Email" error={fieldError('email')}>
          <Input type="email" value={form.email} onChange={set('email')} required autoComplete="email" placeholder="you@example.com" invalid={!!fieldError('email')} />
        </Field>
        <Field label="Password" hint="At least 8 characters" error={fieldError('password')}>
          <Input type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" invalid={!!fieldError('password')} />
        </Field>
        {error && !error.message.includes('highlighted') && (
          <p className="text-[14px] text-card-red">{error.message}</p>
        )}
        <Button type="submit" size="lg" fullWidth loading={busy}>Create account</Button>
      </form>
    </AuthShell>
  )
}

export function VerifyEmailScreen() {
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function resend() {
    setBusy(true)
    try {
      await api.post('auth/resend-verification', { email })
      setSent(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle={email ? `We sent a confirmation link to ${email}` : 'We sent you a confirmation link'}
      footer={<Link to="/login" className="text-volt-400">Back to sign in</Link>}
    >
      <div className="surface p-5 text-center">
        <p className="text-[15px] leading-relaxed text-chalk-muted">
          Click the link in that email to confirm your address, then come back and sign in.
        </p>
        <div className="mt-5">
          {sent ? (
            <p className="text-[14px] text-volt-400">Sent — check your inbox again.</p>
          ) : (
            <Button variant="secondary" onClick={resend} loading={busy} disabled={!email}>
              Resend the email
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  )
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const supabase = await getSupabase()
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    // Always report success — confirming which addresses are registered would
    // let anyone enumerate the user list.
    setSent(true)
    setBusy(false)
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link"
      footer={<Link to="/login" className="text-volt-400">Back to sign in</Link>}
    >
      {sent ? (
        <div className="surface p-5 text-center text-[15px] leading-relaxed text-chalk-muted">
          If there's an account for that address, a reset link is on its way.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Button type="submit" size="lg" fullWidth loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordScreen() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = await getSupabase()
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setError('That link has expired. Request a new one.')
      setBusy(false)
      return
    }
    navigate('/app', { replace: true })
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        {error && <p className="text-[14px] text-card-red">{error}</p>}
        <Button type="submit" size="lg" fullWidth loading={busy}>Save password</Button>
      </form>
    </AuthShell>
  )
}
