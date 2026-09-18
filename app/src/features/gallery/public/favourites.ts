/**
 * Favourites without an account. The visitor id and the hearted ids live in
 * this browser only; the server just counts one heart per visitor per item.
 * Storage can be unavailable (private mode) — everything degrades to
 * in-memory for the visit.
 */

import { useCallback, useState } from 'react'

const VISITOR_KEY = 'ttb.visitor'
const memory = new Map<string, string>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    memory.set(key, value)
  }
}

export function visitorId(): string {
  let id = read(VISITOR_KEY)
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, '')
    write(VISITOR_KEY, id)
  }
  return id
}

export function useFavourites(slug: string) {
  const key = `ttb.fav.${slug}`
  const [ids, setIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(read(key) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })

  const set = useCallback((id: string, on: boolean) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      write(key, JSON.stringify([...next].slice(-500)))
      return next
    })
  }, [key])

  return { ids, has: (id: string) => ids.has(id), set }
}
