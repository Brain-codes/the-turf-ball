/**
 * Offline queue for match-day writes. SPEC.md §7.4.
 *
 * The organizer is at a pitch, often with one bar of signal. A goal tapped in
 * during a dead spot must not be lost, and a retry once signal returns must not
 * count the goal twice. Every queued write carries a client_key; the server has
 * a unique index on (match_id, client_key), so replaying the queue is safe.
 */

import { openDB, type IDBPDatabase } from 'idb'
import { api } from '@/services/client'

export interface QueuedEvent {
  client_key: string
  match_id: string
  event_type: string
  player_id: string
  related_player_id?: string | null
  minute?: number | null
  queued_at: number
}

const DB_NAME = 'turfball'
const STORE = 'pending-events'

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'client_key' })
        }
      },
    })
  }
  return dbPromise
}

export function newClientKey(): string {
  return crypto.randomUUID()
}

export async function enqueue(event: QueuedEvent): Promise<void> {
  const database = await db()
  await database.put(STORE, event)
}

export async function dequeue(clientKey: string): Promise<void> {
  const database = await db()
  await database.delete(STORE, clientKey)
}

export async function pending(): Promise<QueuedEvent[]> {
  const database = await db()
  return (await database.getAll(STORE)) as QueuedEvent[]
}

export async function pendingCount(): Promise<number> {
  const database = await db()
  return database.count(STORE)
}

let flushing = false

/**
 * Push everything queued to the server. Safe to call repeatedly — the guard
 * prevents overlapping flushes, and the server deduplicates by client_key.
 */
export async function flush(): Promise<{ synced: number; remaining: number }> {
  if (flushing || !navigator.onLine) {
    return { synced: 0, remaining: await pendingCount() }
  }

  flushing = true
  try {
    const queued = await pending()
    if (queued.length === 0) return { synced: 0, remaining: 0 }

    const { data } = await api.post<{ client_key?: string; ok: boolean }[]>('events/batch', {
      events: queued.map((e) => ({
        match_id: e.match_id,
        event_type: e.event_type,
        player_id: e.player_id,
        related_player_id: e.related_player_id ?? null,
        minute: e.minute ?? null,
        client_key: e.client_key,
      })),
    })

    let synced = 0
    for (const result of data ?? []) {
      // Only clear entries the server confirmed. A failure stays queued so the
      // next flush tries again rather than silently dropping a goal.
      if (result.ok && result.client_key) {
        await dequeue(result.client_key)
        synced++
      }
    }

    return { synced, remaining: await pendingCount() }
  } catch {
    return { synced: 0, remaining: await pendingCount() }
  } finally {
    flushing = false
  }
}

/** Flush whenever the network comes back, and periodically as a safety net. */
export function startAutoFlush(onChange?: (remaining: number) => void): () => void {
  const run = async () => {
    const { remaining } = await flush()
    onChange?.(remaining)
  }

  window.addEventListener('online', run)
  const interval = window.setInterval(run, 20_000)
  run()

  return () => {
    window.removeEventListener('online', run)
    window.clearInterval(interval)
  }
}
