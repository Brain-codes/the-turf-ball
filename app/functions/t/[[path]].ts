// Cloudflare Pages route for /t/*; hands the path to the Vercel share handler.
import { GET } from '../../api/share'

export const onRequestGet = ({ request, params }: { request: Request; params: { path?: string[] } }) => {
  const url = new URL(request.url)
  url.searchParams.set('path', (params.path ?? []).join('/'))
  return GET(new Request(url, request))
}
