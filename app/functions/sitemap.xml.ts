// Cloudflare Pages route for /sitemap.xml; reuses the Vercel handler.
import { GET } from '../api/sitemap'

export const onRequestGet = () => GET()
