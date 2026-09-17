import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  RiArrowDownLine,
  RiArrowRightLine,
  RiCalendarScheduleLine,
  RiGroupLine,
  RiLinksLine,
  RiMedalLine,
  RiShareForwardLine,
  RiShieldCheckLine,
  RiSwordLine,
  RiTimerLine,
  RiTrophyLine,
  RiUserAddLine,
  RiWhatsappLine,
  RiWifiOffLine,
} from '@remixicon/react'
import { PublicNavbar } from '@/components/layout/PublicNavbar'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { PitchCanvas } from '@/features/landing/PitchCanvas'
import { cn } from '@/lib/cn'
import { SITE_NAME, SITE_URL, DEFAULT_DESCRIPTION, useSeo } from '@/lib/seo'
import { useAccountLink } from '@/components/layout/useAccountLink'

gsap.registerPlugin(ScrollTrigger)

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

const STEPS = [
  { icon: RiGroupLine, title: 'Name your group', body: 'Your group name, where you play and when. About a minute.' },
  { icon: RiUserAddLine, title: 'Bring the players in', body: 'Add them yourself, or drop one invite link in the group chat and let them sign themselves up.' },
  { icon: RiCalendarScheduleLine, title: 'Set your schedule', body: 'Tell it your usual days and kick-off time. Sessions open on their own.' },
  { icon: RiTrophyLine, title: 'Play. The table follows.', body: 'Record what happens. Points, rankings and awards update as you go.' },
]

const POSITIONS = [
  { key: 'FWD', label: 'Forward', goal: 5, assist: 3 },
  { key: 'MID', label: 'Midfielder', goal: 6, assist: 3 },
  { key: 'DEF', label: 'Defender', goal: 7, assist: 4 },
  { key: 'GK', label: 'Goalkeeper', goal: 7, assist: 4 },
] as const

const TABLE = [
  { name: 'Tunde A.', pos: 'MID', pts: 64, g: 7, a: 6 },
  { name: 'Chidi O.', pos: 'FWD', pts: 58, g: 9, a: 2 },
  { name: 'Emeka N.', pos: 'DEF', pts: 51, g: 3, a: 4 },
  { name: 'Seyi B.', pos: 'GK', pts: 47, g: 0, a: 1 },
  { name: 'Kola D.', pos: 'FWD', pts: 42, g: 6, a: 1 },
]

const AWARDS = ['Player of the Month', 'Golden Boot', 'Playmaker', 'Golden Glove', 'Iron Man', 'Most Punctual']

const FAQS = [
  {
    q: 'Is The Turf Ball free?',
    a: 'Yes. Creating a group, adding players, recording matches and sharing your table costs nothing.',
  },
  {
    q: 'Do my players need to download an app?',
    a: 'No. It runs in the browser. Players open the link you share and see the table straight away, with no download and no account.',
  },
  {
    q: 'What if there is no signal at the pitch?',
    a: 'Keep recording. Goals and assists are saved on your phone and sent up as soon as you are back online.',
  },
  {
    q: 'How is Player of the Month decided?',
    a: 'Every goal, assist, clean sheet, card and appearance earns points using rules you set. At the end of the month the player with the most points wins, and the full breakdown is kept so anyone can check it.',
  },
  {
    q: 'Can a defender’s goal be worth more than a striker’s?',
    a: 'Yes. Position-based scoring is built in. By default a goal is worth 5 for a forward, 6 for a midfielder and 7 for a defender or goalkeeper, and you can change every number.',
  },
  {
    q: 'Is it only for 5-a-side?',
    a: 'No. It works for 5-a-side, 7-a-side, full 11-a-side, turf football, Sunday league and any regular kickabout. You can also run competitions with fixed teams and fixtures.',
  },
]

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p data-reveal className="flex items-center gap-3 font-display text-[12px] font-semibold uppercase tracking-[0.22em] text-volt-400">
      <span className="tabular text-chalk-faint">{n}</span>
      <span className="h-px w-8 bg-volt-400/50" />
      {children}
    </p>
  )
}

function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} data-section className={cn('relative mx-auto flex min-h-[100svh] max-w-6xl scroll-mt-24 items-center px-5 py-24 sm:px-8', className)}>
      <div className="w-full">{children}</div>
    </section>
  )
}

function Glass({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      data-reveal
      className={cn(
        'rounded-[24px] border border-pitch-600/60 bg-pitch-900/90 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 data-reveal className="mt-5 max-w-xl text-[clamp(2rem,5.2vw,3.5rem)] leading-[1.02]">
      {children}
    </h2>
  )
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <p data-reveal className="mt-5 max-w-lg text-[17px] leading-relaxed text-chalk-muted">
      {children}
    </p>
  )
}

function PrimaryCta({ children = 'Start your group — free' }: { children?: ReactNode }) {
  const account = useAccountLink()
  const member = account.state === 'member'
  return (
    <Link
      to={member ? account.to : '/register'}
      className="group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-volt-400 px-7 text-[16px] font-semibold text-void shadow-[0_0_40px_-8px_rgb(180_255_57/0.6)] transition-all duration-200 hover:bg-volt-300 active:scale-[0.98]"
    >
      {member ? account.label : children}
      <RiArrowRightLine className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
    </Link>
  )
}

/* -------------------------------------------------------------------------- */
/* Interactive pieces                                                          */
/* -------------------------------------------------------------------------- */

/** A slice of the match-day recorder. Tapping GOAL really bumps the score. */
function MatchDayMock() {
  const [blue, setBlue] = useState(2)
  const [red, setRed] = useState(1)
  const [feed, setFeed] = useState(['24′  Goal — Chidi O. (assist Tunde A.)', '17′  Goal — Kola D.', '9′  Goal — Emeka N.'])
  const [pop, setPop] = useState(0)

  const score = (side: 'blue' | 'red') => {
    const minute = 25 + feed.length * 3
    if (side === 'blue') setBlue((v) => v + 1)
    else setRed((v) => v + 1)
    setFeed((f) => [`${minute}′  Goal — ${side === 'blue' ? 'Tunde A.' : 'Seyi B.'}`, ...f].slice(0, 4))
    setPop((p) => p + 1)
  }

  return (
    <Glass className="p-5 sm:p-6">
      <div className="flex items-center justify-between text-[12px] text-chalk-muted">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-card-red" /> LIVE · Match 3
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-pitch-700/70 px-2.5 py-1">
          <RiWifiOffLine className="h-3.5 w-3.5" /> Saved offline
        </span>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-center">
        <div>
          <p className="text-[13px] font-semibold text-assist-blue">BLUE</p>
        </div>
        <p key={pop} className="numeric animate-[score-pop_400ms_var(--ease-spring)] text-6xl text-chalk" aria-live="polite">
          {blue}<span className="px-2 text-chalk-faint">–</span>{red}
        </p>
        <div>
          <p className="text-[13px] font-semibold text-card-red">RED</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => score('blue')} className="h-14 rounded-2xl bg-volt-400 font-display text-[15px] font-bold text-void transition-transform active:scale-95">
          GOAL · BLUE
        </button>
        <button type="button" onClick={() => score('red')} className="h-14 rounded-2xl border border-pitch-600 bg-pitch-800 font-display text-[15px] font-bold text-chalk transition-transform active:scale-95">
          GOAL · RED
        </button>
      </div>
      <ul className="mt-5 space-y-2 border-t border-pitch-700 pt-4 text-[13.5px] text-chalk-muted">
        {feed.map((line, i) => (
          <li key={line + i} className={cn('tabular', i === 0 && 'text-chalk')}>{line}</li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] text-chalk-faint">Try it — tap a goal button.</p>
    </Glass>
  )
}

function PointsPicker() {
  const [pick, setPick] = useState<(typeof POSITIONS)[number]['key']>('DEF')
  const current = POSITIONS.find((p) => p.key === pick)!
  const goals = 2
  const assists = 1
  const total = current.goal * goals + current.assist * assists + 1

  return (
    <Glass className="p-5 sm:p-6">
      <p className="text-[13px] text-chalk-muted">Same game, different position: 2 goals, 1 assist, 1 appearance.</p>
      <div role="radiogroup" aria-label="Position" className="mt-4 grid grid-cols-4 gap-1.5 rounded-2xl bg-pitch-800 p-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={pick === p.key}
            onClick={() => setPick(p.key)}
            className={cn(
              'h-11 rounded-xl text-[13px] font-semibold transition-colors duration-200',
              pick === p.key ? 'bg-volt-400 text-void' : 'text-chalk-muted hover:text-chalk',
            )}
          >
            {p.key}
          </button>
        ))}
      </div>
      <dl className="mt-5 space-y-2.5 text-[15px]">
        <div className="flex justify-between"><dt className="text-chalk-muted">2 goals × {current.goal}</dt><dd className="tabular">{current.goal * goals}</dd></div>
        <div className="flex justify-between"><dt className="text-chalk-muted">1 assist × {current.assist}</dt><dd className="tabular">{current.assist * assists}</dd></div>
        <div className="flex justify-between"><dt className="text-chalk-muted">Appearance</dt><dd className="tabular">1</dd></div>
      </dl>
      <div className="mt-4 flex items-end justify-between border-t border-pitch-700 pt-4">
        <p className="text-[13px] text-chalk-muted">{current.label} total</p>
        <p key={total} className="numeric animate-[score-pop_400ms_var(--ease-spring)] text-5xl text-volt-400">{total} pts</p>
      </div>
      <p className="mt-3 text-[12px] text-chalk-faint">Default values — every number is yours to change.</p>
    </Glass>
  )
}

function TableMock() {
  return (
    <Glass className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-pitch-700 px-5 py-4">
        <p className="font-display font-semibold">September table</p>
        <span className="rounded-full bg-pitch-700/70 px-2.5 py-1 text-[12px] text-chalk-muted">Updated just now</span>
      </div>
      <ol>
        {TABLE.map((r, i) => (
          <li key={r.name} data-row className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-pitch-800 px-5 py-3.5 last:border-0">
            <span className={cn('numeric text-xl', i === 0 ? 'text-volt-400' : 'text-chalk-faint')}>{i + 1}</span>
            <span>
              <span className="block text-[15px] font-medium">{r.name}</span>
              <span className="text-[12px] text-chalk-faint">{r.pos} · {r.g}G {r.a}A</span>
            </span>
            <span className="numeric text-2xl">{r.pts}</span>
          </li>
        ))}
      </ol>
    </Glass>
  )
}

function AwardMock() {
  return (
    <Glass className="relative overflow-hidden p-6 text-center">
      <div className="absolute inset-x-0 -top-24 mx-auto h-48 w-48 rounded-full bg-volt-400/20 blur-3xl" aria-hidden />
      <RiMedalLine className="relative mx-auto h-10 w-10 text-volt-400" />
      <p className="relative mt-3 text-[12px] uppercase tracking-[0.2em] text-chalk-muted">Player of the Month · August</p>
      <p className="relative mt-2 font-display text-3xl font-bold">Tunde Adeyemi</p>
      <p className="relative mt-1 text-[14px] text-chalk-muted">64 points · 7 goals · 6 assists · never late</p>
      <div className="relative mt-5 flex flex-wrap justify-center gap-2">
        {AWARDS.slice(1).map((a) => (
          <span key={a} className="rounded-full border border-pitch-600 px-3 py-1.5 text-[12px] text-chalk-muted">{a}</span>
        ))}
      </div>
    </Glass>
  )
}

function ShareMock() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Glass className="p-5">
        <p className="flex items-center gap-2 text-[13px] text-chalk-muted"><RiWhatsappLine className="h-4 w-4 text-turf-400" /> Sunday Ballers</p>
        <div className="mt-4 max-w-[90%] rounded-2xl rounded-tl-sm bg-turf-600/40 p-3.5 text-[14px] leading-relaxed">
          Table's updated 👇 Tunde's still top but Chidi is 6 behind
          <div className="mt-2.5 rounded-xl bg-void/60 p-3">
            <p className="text-[12px] text-chalk-faint">the-turf-ball.vercel.app</p>
            <p className="mt-0.5 font-semibold">Sunday Ballers — September table</p>
          </div>
        </div>
        <p className="mt-3 text-right text-[12px] text-chalk-faint">No app. No login. Just the link.</p>
      </Glass>
      <Glass className="p-5">
        <p className="flex items-center gap-2 text-[13px] text-chalk-muted"><RiSwordLine className="h-4 w-4 text-volt-400" /> Head-to-head</p>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <p className="font-display font-semibold">Tunde</p>
          <p className="text-[12px] text-chalk-faint">vs</p>
          <p className="font-display font-semibold">Chidi</p>
        </div>
        {[['Goals', 7, 9], ['Assists', 6, 2], ['Points', 64, 58]].map(([k, l, r]) => (
          <div key={k} className="mt-3">
            <div className="flex justify-between text-[13px]"><span className="tabular">{l}</span><span className="text-chalk-faint">{k}</span><span className="tabular">{r}</span></div>
            <div className="mt-1.5 flex h-1.5 gap-1">
              <div className="rounded-full bg-volt-400" style={{ flex: Number(l) }} />
              <div className="rounded-full bg-assist-blue" style={{ flex: Number(r) }} />
            </div>
          </div>
        ))}
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-chalk-faint"><RiShareForwardLine className="h-4 w-4" /> Share it as an image</p>
      </Glass>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()

  useSeo({
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: SITE_URL,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: 'SportsApplication',
        operatingSystem: 'Web browser',
        description: DEFAULT_DESCRIPTION,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  })

  // Scroll to #section links (the footer uses them); otherwise start at the top.
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    const el = document.getElementById(hash.slice(1))
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth' }))
  }, [hash])

  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = gsap.context(() => {
      if (reduced) return

      // Hero: words rise in one after another.
      gsap.from('[data-hero-word]', { yPercent: 110, opacity: 0, duration: 0.9, stagger: 0.06, ease: 'expo.out', delay: 0.15 })
      gsap.from('[data-hero-fade]', { y: 16, opacity: 0, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.55 })
      // Hero copy drifts up and fades as you leave it.
      gsap.to('[data-hero]', {
        yPercent: -12,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: 'bottom top', scrub: true },
      })

      // Every other section: its pieces arrive as it comes into view.
      gsap.utils.toArray<HTMLElement>('[data-section]').forEach((section) => {
        const items = section.querySelectorAll('[data-reveal]')
        if (!items.length) return
        gsap.from(items, {
          y: 36,
          opacity: 0,
          duration: 0.9,
          stagger: 0.08,
          ease: 'power3.out',
          scrollTrigger: { trigger: section, start: 'top 72%', once: true },
        })
      })

      // Table rows slide in a beat after their card.
      gsap.from('[data-row]', {
        x: -20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.07,
        ease: 'power2.out',
        scrollTrigger: { trigger: '[data-row]', start: 'top 80%', once: true },
      })

      // The "how it works" line fills as you read down the steps.
      gsap.fromTo('[data-progress-line]', { scaleY: 0 }, {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: { trigger: '[data-steps]', start: 'top 70%', end: 'bottom 60%', scrub: true },
      })

      // Section rail on the right tracks where you are.
      gsap.to('[data-rail]', {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: { trigger: document.documentElement, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
      })
    }, root)
    return () => ctx.revert()
  }, [])

  const heroWords = ['Every', 'goal.', 'Every', 'assist.']
  const signedOut = useAccountLink().state === 'guest'

  return (
    <div ref={root} className="relative min-h-dvh overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-volt-400 focus:px-4 focus:py-2 focus:text-void">
        Skip to content
      </a>
      <PitchCanvas />

      {/* Scroll progress rail */}
      <div aria-hidden className="fixed right-4 top-1/2 z-30 hidden h-40 w-px -translate-y-1/2 bg-pitch-600/60 lg:block">
        <div data-rail className="h-full w-full origin-top scale-y-0 bg-volt-400" />
      </div>

      <div className="fixed inset-x-0 top-0 z-50">
        <PublicNavbar />
      </div>

      <main id="main">
        {/* 01 — Hero */}
        <section data-hero className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-16 pt-32 sm:px-8 md:justify-center md:pb-24">
          <p data-hero-fade className="inline-flex w-fit items-center gap-2 rounded-full border border-pitch-600/70 bg-pitch-900/80 px-3.5 py-1.5 text-[13px] text-chalk-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-volt-400" /> Free for grassroots football groups
          </p>
          <h1 className="mt-6 max-w-3xl text-[clamp(3rem,11vw,7.5rem)] leading-[0.92] tracking-[-0.04em]">
            {heroWords.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-2 pr-[0.25em] align-bottom">
                <span data-hero-word className={cn('inline-block', i === 1 && 'text-volt-400')}>{w}</span>
              </span>
            ))}
            <span className="sr-only"> Counted, ranked and settled for your football group.</span>
          </h1>
          <p data-hero-fade className="mt-6 max-w-md text-[18px] leading-relaxed text-chalk-muted">
            The Turf Ball turns your Sunday kickabout into a proper league. Record it at the pitch, and the
            points table and Player of the Month work themselves out.
          </p>
          <div data-hero-fade className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <PrimaryCta />
            <Link to="/leaderboard" className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-pitch-600 bg-pitch-900/80 px-7 text-[16px] text-chalk transition-colors hover:border-chalk-faint">
              See live tables
            </Link>
          </div>
          <a href="#problem" data-hero-fade className="mt-14 hidden w-fit items-center gap-2 text-[13px] text-chalk-faint transition-colors hover:text-chalk md:flex">
            <RiArrowDownLine className="h-4 w-4 animate-bounce" /> Scroll to kick off
          </a>
        </section>

        {/* 02 — The problem */}
        <Section id="problem">
          <Eyebrow n="01">The problem</Eyebrow>
          <H2>“Who had the most assists this month?”</H2>
          <Lead>
            Nobody knows. Someone scrolls back through the group chat, someone else swears it was them, and
            Player of the Month comes down to who argues loudest. Your football deserves better than a voice note.
          </Lead>
          <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
            {[['Scores', 'forgotten by Tuesday'], ['Awards', 'decided by vibes'], ['Stats', 'lost in the chat']].map(([k, v]) => (
              <Glass key={k} className="p-5">
                <p className="font-display text-xl font-bold">{k}</p>
                <p className="mt-1 text-[14px] text-chalk-muted">{v}</p>
              </Glass>
            ))}
          </div>
        </Section>

        {/* 03 — How it works */}
        <Section id="how-it-works">
          <Eyebrow n="02">How it works</Eyebrow>
          <H2>Ready before your next kick-off.</H2>
          <Lead>Four short steps and you never have to set anything up again.</Lead>
          <ol data-steps className="relative mt-12 max-w-xl space-y-4 pl-10">
            <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-pitch-600" />
            <span aria-hidden data-progress-line className="absolute bottom-6 left-[15px] top-6 w-px origin-top bg-volt-400" />
            {STEPS.map((s, i) => (
              <li key={s.title} data-reveal className="relative">
                <span className="absolute -left-10 top-5 flex h-[31px] w-[31px] items-center justify-center rounded-full border border-volt-400/60 bg-void font-numeric text-[15px] text-volt-400">
                  {i + 1}
                </span>
                <div className="rounded-[20px] border border-pitch-600/60 bg-pitch-900/90 p-5">
                  <p className="flex items-center gap-2.5 font-display text-[18px] font-bold">
                    <s.icon className="h-5 w-5 text-volt-400" /> {s.title}
                  </p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-chalk-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* 04 — Match day */}
        <Section id="match-day">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Eyebrow n="03">Match day</Eyebrow>
              <H2>Three taps for a goal. Even with no signal.</H2>
              <Lead>
                Mark who turned up and who was late, split the sides, and record goals, assists, cards and clean
                sheets as they happen, one-handed at the side of the pitch.
              </Lead>
              <ul className="mt-8 space-y-3 text-[15px]">
                {[
                  [RiWifiOffLine, 'Works offline, syncs when you’re back'],
                  [RiTimerLine, 'Punctuality tracked from kick-off time'],
                  [RiShieldCheckLine, 'Mistakes can be flagged and corrected'],
                ].map(([Icon, text]) => {
                  const I = Icon as typeof RiWifiOffLine
                  return (
                    <li key={text as string} data-reveal className="flex items-center gap-3 text-chalk-muted">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pitch-800"><I className="h-4 w-4 text-volt-400" /></span>
                      {text as string}
                    </li>
                  )
                })}
              </ul>
            </div>
            <MatchDayMock />
          </div>
        </Section>

        {/* 05 — Points */}
        <Section id="points">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Eyebrow n="04">Points system</Eyebrow>
              <H2>A defender’s goal should count for more.</H2>
              <Lead>
                Goals, assists, clean sheets, appearances, cards and turning up on time all earn points, weighted by
                position. You set the rules, and you can switch attendance or scoring on and off each month.
              </Lead>
            </div>
            <PointsPicker />
          </div>
        </Section>

        {/* 06 — Table & awards */}
        <Section id="awards">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <Eyebrow n="05">Table & awards</Eyebrow>
              <H2>The table works itself out. The awards settle it.</H2>
              <Lead>
                Rankings update the moment a goal is saved. When the month closes, Player of the Month, the Golden
                Boot, the Golden Glove and more are handed out with the full points breakdown kept for good.
              </Lead>
              <div className="mt-8"><AwardMock /></div>
            </div>
            <TableMock />
          </div>
        </Section>

        {/* 07 — Sharing */}
        <Section id="share">
          <Eyebrow n="06">Share it</Eyebrow>
          <H2>One link. The whole group sees where they stand.</H2>
          <Lead>
            Your group gets its own public page with the table, top scorers, player profiles and live match scores.
            Drop it in WhatsApp, and compare any two players head-to-head with a card made for sharing.
          </Lead>
          <div className="mt-10 max-w-3xl"><ShareMock /></div>
        </Section>

        {/* 08 — Runs itself */}
        <Section id="automatic">
          <Eyebrow n="07">Hands-off</Eyebrow>
          <H2>Set it once. It runs every week.</H2>
          <div className="mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [RiCalendarScheduleLine, 'Sessions open themselves', 'Your weekly schedule creates each session. Sessions pause if nothing happens and close on their own.'],
              [RiLinksLine, 'Players join themselves', 'Share the invite link. New players sign up with their name and position; you approve.'],
              [RiTrophyLine, 'Months close themselves', 'The month ends, the winners are named and a new table starts.'],
              [RiSwordLine, 'Competitions', 'Run fixed teams with fixtures and a points table alongside your regular games.'],
              [RiGroupLine, 'Bring your co-organisers', 'Invite admins to help record, with roles so only the right people change things.'],
              [RiShieldCheckLine, 'Every point explained', 'Tap any player to see exactly how their total was calculated.'],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof RiTrophyLine
              return (
                <Glass key={title as string} className="p-5 transition-colors duration-200 hover:border-volt-400/40">
                  <I className="h-6 w-6 text-volt-400" />
                  <p className="mt-4 font-display text-[17px] font-bold">{title as string}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-chalk-muted">{body as string}</p>
                </Glass>
              )
            })}
          </div>
        </Section>

        {/* 09 — FAQ */}
        <Section id="faq" className="min-h-0">
          <Eyebrow n="08">Questions</Eyebrow>
          <H2>Good questions.</H2>
          <div className="mt-10 max-w-2xl space-y-2.5">
            {FAQS.map((f) => (
              <details key={f.q} data-reveal className="group rounded-[20px] border border-pitch-600/60 bg-pitch-900/90 open:border-pitch-600">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  <h3 className="font-sans text-[16px] font-medium tracking-normal">{f.q}</h3>
                  <span aria-hidden className="text-xl text-volt-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-5 text-[15px] leading-relaxed text-chalk-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* 10 — Final call */}
        <Section className="text-center">
          <div className="mx-auto max-w-2xl">
            <p data-reveal className="font-display text-[12px] font-semibold uppercase tracking-[0.22em] text-volt-400">Full time</p>
            <h2 data-reveal className="mt-5 text-[clamp(2.5rem,7vw,5rem)] leading-[0.98]">Your group’s season starts this Sunday.</h2>
            <p data-reveal className="mx-auto mt-5 max-w-md text-[17px] leading-relaxed text-chalk-muted">
              Free to set up. No app for your players to download. Ready before kick-off.
            </p>
            <div data-reveal className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <PrimaryCta>Set up your group</PrimaryCta>
              {signedOut && (
                <Link to="/login" className="inline-flex h-14 items-center px-6 text-[16px] text-chalk-muted transition-colors hover:text-chalk">
                  I already have an account
                </Link>
              )}
            </div>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  )
}
