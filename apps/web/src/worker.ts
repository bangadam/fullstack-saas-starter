// Custom Worker entry: wraps the TanStack Start handler with a same-origin
// /api and /webhooks proxy. See wrangler.jsonc "main" and lib/proxy.ts for the
// routing contract.
import handler from '@tanstack/react-start/server-entry'
import { isProxiedPath, upstreamRequest } from '~/lib/proxy'

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (isProxiedPath(pathname)) {
      // Fixed service binding target — never a URL derived from user input.
      return env.API_WORKER.fetch(upstreamRequest(request))
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
