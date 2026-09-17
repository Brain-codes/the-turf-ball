/**
 * Serves index.html for a team page (/t/:slug) or player page
 * (/t/:slug/player/:id) with that team's or player's title, description and
 * canonical URL already filled in, so a WhatsApp or Google preview shows
 * "Sunday Ballers" and not the generic home-page text.
 */

import { SITE_URL, escapeHtml, publicApi } from './_lib.js'

type Org = { name: string; slug: string; description?: string | null; location?: string | null; venue?: string | null; logo_url?: string | null }
type TeamData = { organization: Org }
type PlayerData = { organization: Org; player: { display_name: string; position?: string | null }; stats?: { goals?: number; assists?: number } | null }

function replaceMeta(html: string, title: string, description: string, url: string, image?: string | null) {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const u = escapeHtml(url)
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${u}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${u}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
  if (image) {
    const i = escapeHtml(image)
    out = out
      .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${i}$2`)
      .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${i}$2`)
  }
  return out
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.searchParams.get('path') || ''
  const [slug, kind, playerId] = path.split('/').filter(Boolean)

  const shellRes = await fetch(`${url.origin}/index.html`)
  let html = await shellRes.text()

  if (slug && /^[a-z0-9-]+$/i.test(slug)) {
    const pageUrl = `${SITE_URL}/t/${slug}${kind === 'player' && playerId ? `/player/${playerId}` : ''}`

    if (kind === 'player' && playerId && /^[0-9a-f-]{36}$/i.test(playerId)) {
      const data = await publicApi<PlayerData>(`${slug}/player/${playerId}`)
      if (data) {
        const name = data.player.display_name
        const bits = [
          data.stats?.goals != null ? `${data.stats.goals} goals` : null,
          data.stats?.assists != null ? `${data.stats.assists} assists` : null,
        ].filter(Boolean).join(', ')
        html = replaceMeta(
          html,
          `${name} — ${data.organization.name} player stats | The Turf Ball`,
          `${name}'s goals, assists, points and awards for ${data.organization.name}${bits ? ` (${bits} this month)` : ''}. Live stats on The Turf Ball.`,
          pageUrl,
          data.organization.logo_url,
        )
      }
    } else if (!kind) {
      const data = await publicApi<TeamData>(slug)
      if (data) {
        const org = data.organization
        const where = [org.venue, org.location].filter(Boolean).join(', ')
        html = replaceMeta(
          html,
          `${org.name} — league table, top scorers & Player of the Month | The Turf Ball`,
          org.description?.trim() ||
            `${org.name}${where ? ` (${where})` : ''}: live points table, top scorers, assists and Player of the Month, updated after every game.`,
          pageUrl,
          org.logo_url,
        )
      }
    }
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Fresh enough for previews, cheap enough to not hit the API per view.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}
