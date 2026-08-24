import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  RiBarChart2Fill, RiBarChart2Line,
  RiCalendarEventFill, RiCalendarEventLine,
  RiHome4Fill, RiHome4Line,
  RiLogoutBoxRLine,
  RiMedalFill, RiMedalLine,
  RiSettings3Fill, RiSettings3Line,
  RiTeamFill, RiTeamLine,
  RiTrophyFill, RiTrophyLine,
} from '@remixicon/react'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/cn'

/**
 * App chrome. Left rail on desktop, bottom tab bar on mobile.
 * Match-day mode deliberately renders outside this shell — that screen replaces
 * all navigation with its own.
 */

type IconType = ComponentType<{ className?: string }>

const NAV: { to: string; label: string; end?: boolean; iconLine: IconType; iconFill: IconType }[] = [
  { to: '/app', label: 'Home', end: true, iconLine: RiHome4Line, iconFill: RiHome4Fill },
  { to: '/app/players', label: 'Squad', iconLine: RiTeamLine, iconFill: RiTeamFill },
  { to: '/app/sessions', label: 'Sessions', iconLine: RiCalendarEventLine, iconFill: RiCalendarEventFill },
  { to: '/app/leaderboard', label: 'Table', iconLine: RiBarChart2Line, iconFill: RiBarChart2Fill },
  { to: '/app/awards', label: 'Awards', iconLine: RiTrophyLine, iconFill: RiTrophyFill },
]

const RAIL_COLLAPSED_KEY = 'turfball:rail-collapsed'

function NavIcon({ active, iconLine: Line, iconFill: Fill, className }: {
  active: boolean
  iconLine: IconType
  iconFill: IconType
  className?: string
}) {
  const Icon = active ? Fill : Line
  return <Icon className={className} />
}

export function AppShell() {
  const { activeOrg, organizations, switchOrg, signOut } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(RAIL_COLLAPSED_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop rail */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-pitch-700 bg-pitch-900 p-4 md:fixed md:inset-y-0 md:left-0 md:flex md:h-dvh md:flex-col',
          'relative transition-[width] duration-150',
          collapsed ? 'md:w-[72px]' : 'md:w-60',
        )}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-[50px] flex h-6 w-6 items-center justify-center rounded-full border border-pitch-700 bg-pitch-800 text-[11px] text-chalk-muted shadow-sm hover:text-chalk"
        >
          {collapsed ? '›' : '‹'}
        </button>

        <div className={cn('mb-6 flex items-center gap-2.5 px-2', collapsed && 'justify-center px-0')}>
          <span className="text-2xl">⚽</span>
          {!collapsed && <span className="font-display text-[15px] font-bold">The Turf Ball</span>}
        </div>

        {!collapsed && (
          organizations.length > 1 ? (
            <select
              value={activeOrg?.id ?? ''}
              onChange={(e) => switchOrg(e.target.value)}
              className="mb-5 h-10 w-full rounded-lg border border-pitch-700 bg-pitch-800 px-3 text-[14px] text-chalk focus:outline-none"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          ) : (
            <div className="mb-5 truncate px-2 text-[13px] text-chalk-muted">{activeOrg?.name}</div>
          )
        )}

        <nav className="flex-1 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-pitch-800 font-semibold text-chalk'
                    : 'text-chalk-muted hover:bg-pitch-800 hover:text-chalk',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <NavIcon
                    active={isActive}
                    iconLine={item.iconLine}
                    iconFill={item.iconFill}
                    className={cn('h-[19px] w-[19px] shrink-0', isActive ? 'text-volt-400' : 'opacity-80')}
                  />
                  {!collapsed && item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Secondary — kept off the 5-item mobile tab bar; a competition is
            occasional, not a daily destination, so it lives one tap away
            from Sessions on mobile instead of claiming a permanent tab. */}
        <div className="space-y-1 border-t border-pitch-700 pt-3">
          <NavLink
            to="/app/competitions"
            title={collapsed ? 'Competitions' : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px]',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-pitch-800 text-chalk' : 'text-chalk-muted hover:text-chalk',
              )
            }
          >
            {({ isActive }) => (
              <>
                <NavIcon
                  active={isActive}
                  iconLine={RiMedalLine}
                  iconFill={RiMedalFill}
                  className={cn('h-[19px] w-[19px] shrink-0', isActive ? 'text-volt-400' : 'opacity-80')}
                />
                {!collapsed && 'Competitions'}
              </>
            )}
          </NavLink>
        </div>

        <div className="space-y-1 border-t border-pitch-700 pt-3">
          <NavLink
            to="/app/settings"
            title={collapsed ? 'Settings' : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px]',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-pitch-800 text-chalk' : 'text-chalk-muted hover:text-chalk',
              )
            }
          >
            {({ isActive }) => (
              <>
                <NavIcon
                  active={isActive}
                  iconLine={RiSettings3Line}
                  iconFill={RiSettings3Fill}
                  className={cn('h-[19px] w-[19px] shrink-0', isActive ? 'text-volt-400' : 'opacity-80')}
                />
                {!collapsed && 'Settings'}
              </>
            )}
          </NavLink>
          <button
            onClick={signOut}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-chalk-muted hover:text-chalk',
              collapsed && 'justify-center px-0',
            )}
          >
            <RiLogoutBoxRLine className="h-[19px] w-[19px] shrink-0 opacity-80" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className={cn('min-w-0 flex-1 pb-24 md:pb-0 transition-[margin] duration-150', collapsed ? 'md:ml-[72px]' : 'md:ml-60')}>
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
                <NavIcon active={active} iconLine={item.iconLine} iconFill={item.iconFill} className="h-[21px] w-[21px]" />
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
