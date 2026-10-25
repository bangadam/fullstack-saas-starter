import { siteConfig } from '~/lib/site-config'

/**
 * Cloudflare Turnstile placeholder. Rendering is gated behind siteConfig.turnstile
 * (backed by the VITE_TURNSTILE_SITE_KEY var) until a real site key exists and
 * server-side verification is wired in the API Worker.
 */
export function TurnstilePlaceholder() {
  if (!siteConfig.turnstile.enabled || !siteConfig.turnstile.siteKey) {
    return (
      <div className="flex h-[65px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        Turnstile placeholder — bot protection pending configuration
      </div>
    )
  }

  return (
    <div className="cf-turnstile" data-sitekey={siteConfig.turnstile.siteKey} data-theme="light" />
  )
}
