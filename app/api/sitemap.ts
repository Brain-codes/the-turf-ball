/**
 * /sitemap.xml — the fixed public pages plus every public team page.
 */

import { SITE_URL, escapeHtml, publicApi } from './_lib.js'

type TeamsPage = { team: { slug: string } }[]

const STATIC = [
  { path: '/', priority: '1.0', freq: 'weekly' },
  { path: '/leaderboard', priority: '0.8', freq: 'daily' },
  { path: '/h2h', priority: '0.6', freq: 'daily' },
  { path: '/contact', priority: '0.4', freq: 'yearly' },
  { path: '/register', priority: '0.5', freq: 'monthly' },
  { path: '/login', priority: '0.3', freq: 'monthly' },
]

export async function GET(): Promise<Response> {
  const slugs = new Set<string>()
  for (let page = 1; page <= 20; page++) {
    const rows = await publicApi<TeamsPage>(`leaderboard/teams?per_page=100&page=${page}`)
    if (!rows?.length) break
    rows.forEach((r) => r.team?.slug && slugs.add(r.team.slug))
    if (rows.length < 100) break
  }

  const urls = [
    ...STATIC.map((s) => `<url><loc>${SITE_URL}${s.path}</loc><changefreq>${s.freq}</changefreq><priority>${s.priority}</priority></url>`),
    ...[...slugs].map((slug) => `<url><loc>${SITE_URL}/t/${escapeHtml(slug)}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`),
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
