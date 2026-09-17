import { Link } from 'react-router-dom'
import { RiArrowRightUpLine } from '@remixicon/react'
import { BrandMark } from './PublicNavbar'

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', to: '/#how-it-works' },
      { label: 'Match day', to: '/#match-day' },
      { label: 'Points system', to: '/#points' },
      { label: 'Awards', to: '/#awards' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { label: 'All group tables', to: '/leaderboard' },
      { label: 'Head-to-head', to: '/h2h' },
      { label: 'Questions', to: '/#faq' },
      { label: 'Contact us', to: '/contact' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Start a group', to: '/register' },
      { label: 'Log in', to: '/login' },
      { label: 'Forgot password', to: '/forgot-password' },
    ],
  },
]

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative border-t border-pitch-700/70 bg-void">
      <div className="mx-auto max-w-6xl px-5 pb-10 pt-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-bold text-chalk">
              <BrandMark className="h-8 w-8" />
              The Turf Ball
            </Link>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-chalk-muted">
              Stats, points and Player of the Month for grassroots football groups. Recorded at the pitch,
              worked out for you, shared in one link.
            </p>
            <Link
              to="/register"
              className="group mt-6 inline-flex items-center gap-2 rounded-full border border-volt-400/50 px-5 py-3 text-[14px] font-semibold text-volt-400 transition-colors hover:bg-volt-400 hover:text-void"
            >
              Start your group, free
              <RiArrowRightUpLine className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-chalk-faint">{col.title}</h2>
                <ul className="mt-4 space-y-1">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link to={l.to} className="inline-block py-1.5 text-[15px] text-chalk-muted transition-colors hover:text-chalk">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        {/* Oversized wordmark — the footer's signature. */}
        <p
          aria-hidden
          className="mt-16 select-none bg-gradient-to-b from-pitch-600 to-transparent bg-clip-text text-center font-numeric text-[clamp(4rem,17vw,13rem)] leading-[0.8] text-transparent"
        >
          THE TURF BALL
        </p>

        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-pitch-700/70 pt-6 text-[13px] text-chalk-faint sm:flex-row">
          <p>© {year} The Turf Ball. Built for Sunday football.</p>
          <p className="flex items-center gap-2">
            Powered by
            <span className="font-display font-semibold tracking-wide text-chalk">Anonimos Brain</span>
            <span className="h-1.5 w-1.5 rounded-full bg-volt-400" aria-hidden />
          </p>
        </div>
      </div>
    </footer>
  )
}
