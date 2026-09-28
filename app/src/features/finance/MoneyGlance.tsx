import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RiArrowRightSLine, RiWallet3Line } from '@remixicon/react'
import { api } from '@/services/client'
import { useAuth } from '@/features/auth/AuthProvider'
import type { FinanceOverview } from '@/types'
import { formatMoney } from './money'

/**
 * The money line on the home screen. Admins only, and only with money on.
 * It's also how phones reach the money screen, since the tab bar is full.
 */
export function MoneyGlance() {
  const { activeOrg } = useAuth()
  const show = !!activeOrg?.finance_enabled && (activeOrg.role === 'owner' || activeOrg.role === 'admin')

  const { data } = useQuery({
    queryKey: ['finance', activeOrg?.id, 'overview'],
    queryFn: async () => (await api.get<FinanceOverview>('finance/overview')).data,
    enabled: show,
  })

  if (!show) return null
  const s = data?.summary
  const currency = data?.settings.currency ?? 'NGN'
  const due = (s?.due_soon_count ?? 0) + (s?.expired_count ?? 0)

  return (
    <Link
      to="/app/finance"
      className="surface mb-7 flex min-h-16 items-center gap-3.5 px-4 py-3.5 transition-colors hover:border-pitch-600"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-volt-400/15 text-volt-400">
        <RiWallet3Line className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-chalk">Money</span>
        <span className="block truncate text-[13px] text-chalk-muted">
          {!s
            ? 'Loading…'
            : s.outstanding > 0
              ? `${formatMoney(s.outstanding, currency)} owed by ${s.owing_count} player${s.owing_count === 1 ? '' : 's'}`
              : 'Nobody owes anything'}
          {s && due > 0 && ` · ${due} month${due === 1 ? '' : 's'} due`}
        </span>
      </span>
      <RiArrowRightSLine className="h-5 w-5 text-chalk-faint" />
    </Link>
  )
}
