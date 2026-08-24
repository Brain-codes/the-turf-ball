/**
 * Cheap duplicate-name detection for the squad screen — flags likely
 * re-signups (self-serve join link means the same person can submit twice
 * with a slightly different spelling of their own name) so the organizer
 * can review and merge rather than hunting for them manually.
 */

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
    }
    prev = row
  }
  return prev[b.length]
}

/** True if two display names are close enough to be the same person, typo'd or reformatted. */
export function looksLikeSameName(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return false
  if (na === nb) return true

  const maxLen = Math.max(na.length, nb.length)
  if (maxLen < 3) return false

  const distance = levenshtein(na, nb)
  return distance <= Math.max(1, Math.floor(maxLen * 0.25))
}

/** All unordered pairs of items whose name field looks like the same person. */
export function findLikelyDuplicates<T>(items: T[], nameOf: (item: T) => string): [T, T][] {
  const pairs: [T, T][] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (looksLikeSameName(nameOf(items[i]), nameOf(items[j]))) {
        pairs.push([items[i], items[j]])
      }
    }
  }
  return pairs
}
