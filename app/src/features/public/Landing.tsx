import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { FadeIn, Stagger, StaggerItem } from '@/components/motion'

const FEATURES = [
  {
    icon: '⚽',
    title: 'Record it as it happens',
    body: 'Three taps for a goal, right there at the pitch. Works even when your signal drops.',
  },
  {
    icon: '📊',
    title: 'The table works itself out',
    body: 'Goals, assists, clean sheets, punctuality. You decide what each is worth.',
  },
  {
    icon: '🏆',
    title: 'Player of the Month, settled',
    body: 'No more arguing over a voice note. The numbers do the talking.',
  },
  {
    icon: '🔗',
    title: 'One link for the group',
    body: 'Drop it in WhatsApp. Everyone sees where they stand — no app, no account.',
  },
]

export function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="pitch-lines px-5 pb-16 pt-16 text-center">
        <FadeIn>
          <div className="mb-5 text-5xl">⚽</div>
          <h1 className="mx-auto max-w-xl text-[clamp(2.25rem,9vw,3.75rem)] leading-[1.05]">
            Your Sunday league,{' '}
            <span className="text-volt-400">properly tracked</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[16px] leading-relaxed text-chalk-muted">
            Goals, assists and Player of the Month for your football group — recorded at the pitch,
            worked out automatically, shared in one link.
          </p>

          <div className="mx-auto mt-8 flex max-w-xs flex-col gap-2.5">
            <Link to="/register">
              <Button size="xl" fullWidth>Start your group — free</Button>
            </Link>
            <Link to="/login">
              <Button variant="ghost" size="lg" fullWidth>I already have an account</Button>
            </Link>
          </div>
        </FadeIn>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-20">
        <Stagger className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <StaggerItem key={feature.title}>
              <div className="surface h-full p-5">
                <div className="text-2xl">{feature.icon}</div>
                <h2 className="mt-3 text-[17px]">{feature.title}</h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-chalk-muted">{feature.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <FadeIn delay={0.2}>
          <div className="surface-raised mt-10 p-7 text-center">
            <h2 className="text-2xl">Built for real Sunday football</h2>
            <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed text-chalk-muted">
              Not a fantasy league. Not a stats company. Just the tool you wished you had the last
              time someone asked who had the most assists this month.
            </p>
            <Link to="/register">
              <Button size="lg" className="mt-6">Set up your group</Button>
            </Link>
          </div>
        </FadeIn>
      </main>

      <footer className="border-t border-pitch-700 px-5 py-8 text-center text-[13px] text-chalk-faint">
        The Turf Ball
      </footer>
    </div>
  )
}
