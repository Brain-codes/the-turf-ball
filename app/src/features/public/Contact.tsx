import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { RiCheckboxCircleLine, RiMailSendLine } from '@remixicon/react'
import { PublicHero, PublicLayout } from '@/components/layout/PublicLayout'
import { Button, Field, Input, Select } from '@/components/ui'
import { api, ApiError } from '@/services/client'

const TOPICS = [
  { value: 'question', label: 'A question' },
  { value: 'suggestion', label: 'A suggestion or feature idea' },
  { value: 'bug', label: 'Something isn’t working' },
  { value: 'partnership', label: 'Partnership or league enquiry' },
  { value: 'other', label: 'Something else' },
] as const

const schema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(80, 'Keep it under 80 characters'),
  email: z.string().trim().email('Please enter a valid email so we can reply'),
  topic: z.enum(['question', 'suggestion', 'bug', 'partnership', 'other']),
  message: z
    .string()
    .trim()
    .min(10, 'A little more detail, please (at least 10 characters)')
    .max(2000, 'Please keep it under 2,000 characters'),
  // Honeypot. Hidden from people; bots fill it in.
  website: z.string().optional(),
})

type Values = z.infer<typeof schema>

export function ContactScreen() {
  const [token, setToken] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { topic: 'question', website: '' },
    mode: 'onBlur',
  })

  // A server-signed "form opened" stamp — the server rejects anything sent too
  // fast to have been typed by a person.
  useEffect(() => {
    api.public<{ token: string }>('contact/token').then((r) => setToken(r.data.token)).catch(() => setToken(null))
  }, [])

  const length = watch('message')?.length ?? 0

  const onSubmit = async (values: Values) => {
    setServerError(null)
    try {
      let formToken = token
      if (!formToken) formToken = (await api.public<{ token: string }>('contact/token')).data.token
      await api.post('contact', { ...values, form_token: formToken }, { anonymous: true })
      setSent(true)
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not send right now. Please try again in a minute.')
    }
  }

  return (
    <PublicLayout className="pb-20">
      <PublicHero
        icon={RiMailSendLine}
        eyebrow="Contact"
        title={<>Talk to <span className="text-volt-400">us.</span></>}
        lead="A question, an idea for a feature, a bug, or you run a league and want to work together. We read every message."
      />

      <div className="mx-auto max-w-xl px-5">
        {sent ? (
          <div role="status" className="surface-raised p-8 text-center">
            <RiCheckboxCircleLine className="mx-auto h-12 w-12 text-volt-400" />
            <h2 className="mt-4 text-2xl">Message sent</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-chalk-muted">
              Thanks for getting in touch. We’ll reply to the email you gave us.
            </p>
            <Link to="/" className="mt-6 inline-block text-[15px] text-volt-400 underline underline-offset-4">
              Back to the home page
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="surface-raised space-y-5 p-6 sm:p-8">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Your name" error={errors.name?.message}>
                <Input autoComplete="name" invalid={!!errors.name} {...register('name')} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" autoComplete="email" inputMode="email" invalid={!!errors.email} {...register('email')} />
              </Field>
            </div>

            <Field label="What’s it about?" error={errors.topic?.message}>
              <Select {...register('topic')}>
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </Field>

            <Field label="Message" error={errors.message?.message} hint={`${length} / 2000`}>
              <textarea
                rows={6}
                maxLength={2000}
                aria-invalid={!!errors.message}
                className="w-full resize-y rounded-[var(--radius-control)] border border-pitch-700 bg-pitch-900 px-3.5 py-3 text-[15px] leading-relaxed text-chalk placeholder:text-chalk-faint focus:border-volt-400 focus:outline-none"
                placeholder="Tell us what’s on your mind…"
                {...register('message')}
              />
            </Field>

            {/* Honeypot: off-screen, unfocusable, ignored by password managers. */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Website
                <input type="text" tabIndex={-1} autoComplete="off" {...register('website')} />
              </label>
            </div>

            {serverError && (
              <p role="alert" className="rounded-lg border border-card-red/40 bg-card-red/10 px-3.5 py-2.5 text-[14px] text-card-red">
                {serverError}
              </p>
            )}

            <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
              Send message
            </Button>
            <p className="text-center text-[12.5px] text-chalk-faint">
              We only use your email to reply to you.
            </p>
          </form>
        )}
      </div>
    </PublicLayout>
  )
}
