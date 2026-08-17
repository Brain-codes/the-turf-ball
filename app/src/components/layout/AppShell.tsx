import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/cn'

/**
 * App chrome. Left rail on desktop, bottom tab bar on mobile.
 * Match-day mode deliberately renders outside this shell — that screen replaces
 * all navigation with its own.
 */

const NAV = [
  { to: '/app', label: 'Home', icon: '⌂', end: true },
  { to: '/app/players', label: 'Squad', icon: '👥' },
  { to: '/app/sessions', label: 'Sessions', icon: '📅' },
  { to: '/app/leaderboard', label: 'Table', icon: '📊' },
  { to: '/app/awards', label: 'Awards', icon: '🏆' },
]

export function AppShell() {
  const { activeOrg, organizations, switchOrg, signOut } = useAuth()
  const location = useLocation()

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 border-r border-pitch-700 bg-pitch-900 p-4 md:flex md:flex-col">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="text-2xl">⚽</span>
          <span className="font-display text-[15px] font-bold">The Turf Ball</span>
        </div>

        {organizations.length > 1 ? (
          <select
            value={activeOrg?.id ?? ''}
            onChange={(e) => switchOrg(e.target.value)}
            className="mb-5 h-10 w-full rounded-lg border border-pitch-700 bg-pitch-800 px-3 text-[16px] text-chalk focus:outline-none"
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        ) : (
          <div className="mb-5 truncate px-2 text-[13px] text-chalk-muted">{activeOrg?.name}</div>
        )}

        <nav className="flex-1 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] transition-colors',
                  isActive
                    ? 'bg-pitch-800 font-semibold text-chalk'
                    : 'text-chalk-muted hover:bg-pitch-800 hover:text-chalk',
                )
              }
            >
              <span className="w-5 text-center opacity-80">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-pitch-700 pt-3">
          <NavLink
            to="/app/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px]',
                isActive ? 'bg-pitch-800 text-chalk' : 'text-chalk-muted hover:text-chalk',
              )
            }
          >
            <span className="w-5 text-center opacity-80">⚙</span>
            Settings
          </NavLink>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-chalk-muted hover:text-chalk"
          >
            <span className="w-5 text-center opacity-80">↩</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-pitch-700 bg-pitch-900/95 backdrop-blur-lg md:hidden">
        <div className="safe-bottom flex">
          {NAV.map((item) => {
            const active = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px] transition-colors',
                  active ? 'text-volt-400' : 'text-chalk-faint',
                )}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-6">
      <div className="min-w-0">
        <h1 className="truncate text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-chalk-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
