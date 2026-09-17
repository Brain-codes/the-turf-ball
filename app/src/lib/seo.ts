/**
 * Per-page SEO. Sets the title, description, canonical URL, Open Graph /
 * Twitter tags, robots and optional JSON-LD for whichever route is showing.
 * index.html carries the same tags with home-page values, for crawlers and
 * link previews that never run JavaScript.
 */

import { createElement, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || 'https://the-turf-ball.vercel.app'
export const SITE_NAME = 'The Turf Ball'
export const DEFAULT_DESCRIPTION =
  'Free football stats app for grassroots and Sunday league groups. Record goals and assists at the pitch, get an automatic points table and Player of the Month, and share it all in one WhatsApp link.'
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`

type SeoOptions = {
  /** Page title without the site name. Omit for the home page. */
  title?: string
  description?: string
  /** Private or thin pages (dashboard, forms) stay out of search results. */
  noindex?: boolean
  image?: string
  type?: 'website' | 'profile' | 'article'
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

export function useSeo({ title, description = DEFAULT_DESCRIPTION, noindex, image = DEFAULT_IMAGE, type = 'website', jsonLd }: SeoOptions) {
  const { pathname } = useLocation()
  const ld = jsonLd ? JSON.stringify(jsonLd) : ''

  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — Football Stats & Player of the Month for Your Group`
    const url = `${SITE_URL}${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}`

    document.title = fullTitle
    setMeta('name', 'description', description)
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large')
    setLink('canonical', url)

    setMeta('property', 'og:title', fullTitle)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:type', type)
    setMeta('property', 'og:image', image)
    setMeta('name', 'twitter:title', fullTitle)
    setMeta('name', 'twitter:description', description)
    setMeta('name', 'twitter:image', image)

    const script = document.createElement('script')
    if (ld) {
      script.type = 'application/ld+json'
      script.dataset.seo = 'page'
      script.text = ld
      document.head.appendChild(script)
    }
    return () => script.remove()
  }, [title, description, noindex, image, type, ld, pathname])
}

type RouteMeta = { title: string; description?: string; noindex?: boolean }

const APP_TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, 'Dashboard'],
  [/^\/app\/players/, 'Players'],
  [/^\/app\/sessions/, 'Sessions'],
  [/^\/app\/competitions/, 'Competitions'],
  [/^\/app\/leaderboard/, 'Leaderboard'],
  [/^\/app\/h2h/, 'Head-to-head'],
  [/^\/app\/awards/, 'Awards'],
  [/^\/app\/settings/, 'Settings'],
]

function metaFor(pathname: string): RouteMeta | null {
  switch (pathname) {
    case '/leaderboard':
      return {
        title: 'Football Leaderboards — Top Scorers & Assists Across Every Group',
        description: 'Live tables of the top scorers, assist makers and clean-sheet keepers across every grassroots football group on The Turf Ball.',
      }
    case '/h2h':
      return {
        title: 'Head-to-Head Player Comparison',
        description: 'Compare any two grassroots footballers side by side: goals, assists, appearances and points, with a shareable image.',
      }
    case '/contact':
      return {
        title: 'Contact Us',
        description: 'Questions, feature ideas, bug reports or league partnerships — get in touch with The Turf Ball team.',
      }
    case '/register':
      return {
        title: 'Create Your Football Group — Free',
        description: 'Set up your football group in minutes. Track goals, assists and Player of the Month for free. No app for your players to download.',
      }
    case '/login':
      return { title: 'Log in', description: 'Log in to The Turf Ball to run your football group’s sessions, stats and awards.' }
    case '/forgot-password':
      return { title: 'Reset your password', noindex: true }
    case '/verify-email':
      return { title: 'Verify your email', noindex: true }
    case '/reset-password':
      return { title: 'Choose a new password', noindex: true }
    case '/onboarding':
      return { title: 'Set up your group', noindex: true }
  }
  if (pathname.startsWith('/join/') || pathname.startsWith('/play/')) return { title: 'Join a team', noindex: true }
  if (pathname.startsWith('/app')) {
    const hit = APP_TITLES.find(([re]) => re.test(pathname))
    return { title: hit?.[1] ?? 'The Turf Ball', noindex: true }
  }
  return null
}

/**
 * Titles and robots for every route that doesn't set its own. The landing,
 * team, player and live pages call useSeo themselves with real data.
 */
function RouteSeoInner({ meta }: { meta: RouteMeta }) {
  useSeo(meta)
  return null
}

export function RouteSeo() {
  const { pathname } = useLocation()
  const meta = metaFor(pathname)
  return meta ? createElement(RouteSeoInner, { meta }) : null
}
