/**
 * Top nav for the logged-out surfaces (landing, global table, team pages).
 * Sticky, minimal — a way back Home and into the Table from anywhere public.
 */

import { Link, useLocation } from 'react-router-dom'

export function PublicNavbar() {
  const { pathname } = useLocation()

  const linkClass = (active: boolean) =>
    active
      ? 'text-[14px] font-semibold text-volt-400'
      : 'text-[14px] text-chalk-muted transition-colors hover:text-chalk'

  return (
    <nav className="sticky top-0 z-40 border-b border-pitch-700 bg-pitch-900/90 backdrop-blur safe-top">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold text-chalk">
          <span className="text-xl">⚽</span>
          The Turf Ball
        </Link>
        <div className="flex items-center gap-5">
          <Link to="/" className={linkClass(pathname === '/')}>Home</Link>
          <Link to="/leaderboard" className={linkClass(pathname.startsWith('/leaderboard'))}>Table</Link>
          <Link to="/login" className={linkClass(pathname === '/login')}>Log in</Link>
        </div>
      </div>
    </nav>
  )
}
