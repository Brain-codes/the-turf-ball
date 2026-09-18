import { useCallback, useMemo, useState } from 'react'

/** Multi-select state for a grid. Selecting anything turns select mode on. */
export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState(false)

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setMode(true)
  }, [])

  const clear = useCallback(() => {
    setIds(new Set())
    setMode(false)
  }, [])

  const selectAll = useCallback((all: string[]) => {
    setIds(new Set(all))
    setMode(true)
  }, [])

  return useMemo(
    () => ({ ids, list: [...ids], count: ids.size, has: (id: string) => ids.has(id), mode: mode || ids.size > 0, setMode, toggle, clear, selectAll }),
    [ids, mode, toggle, clear, selectAll],
  )
}
