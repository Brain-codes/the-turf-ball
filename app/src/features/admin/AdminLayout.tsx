/**
 * Super admin area. The route guard here is a convenience — every /admin API
 * call is checked on the server (requireSuperAdmin), which is the real control.
 */

import { Navigate, NavLink, Outlet } from 'react-router-dom'
import {
  RiArrowLeftLine,
  RiDashboardLine,
  RiHistoryLine,
  RiMailLine,
  RiShieldStarLine,
  RiTeamLine,
  RiToggleLine,
  RiUserLine,
} from '@remixicon/react'
import { useAuth } from '@/features/auth/AuthProvider'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useSeo } from '@/lib/seo'

const NAV = [
  { to: '/admin', label: 'Overview', icon: RiDashboardLine, end: true },
  { to: '/admin/groups', label: 'Groups', icon: RiTeamLine },
  { to: '/admin/users', label: 'Users', icon: RiUserLine },
  { to: '/admin/features', label: 'Features', icon: RiToggleLine },
  { to: '/admin/messages', label: 'Messages', icon: RiMailLine },
  { to: '/admin/activity', label: 'Activity', icon: RiHistoryLine },
]

export function AdminLayout() {
  const { loading, authenticated, profile } = useAuth()
  useSeo({ title: 'Super admin', noindex: true })

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-6 w-6 text-chalk-muted" />
      </div>
    )
  }
  if (!authenticated) return <Navigate to="/login" replace />
  if (!profile?.is_platform_admin) return <Navigate to="/app" replace />

  return (
    <div className="min-h-dvh md:flex">
      <aside className="border-b border-pitch-700 bg-pitch-900 md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
          <p className="flex items-center gap-2 font-display text-[15px] font-bold">
            <RiShieldStarLine className="h-5 w-5 text-volt-400" /> Super admin
          </p>
          <NavLink to="/app" className="flex min-h-11 items-center gap-1.5 text-[13px] text-chalk-muted hover:text-chalk md:mt-2 md:min-h-0">
            <RiArrowLeftLine className="h-4 w-4" /> Back to app
          </NavLink>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[14.5px] transition-colors',
                  isActive ? 'bg-pitch-800 text-chalk' : 'text-chalk-muted hover:text-chalk',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('h-[18px] w-[18px]', isActive && 'text-volt-400')} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:ml-60 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
