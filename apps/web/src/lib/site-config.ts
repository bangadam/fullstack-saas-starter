export const siteConfig = {
  name: 'SaaS Starter',
  tagline: 'Ship your SaaS on Cloudflare, faster.',
  description:
    'A Cloudflare-native SaaS boilerplate: TanStack Start on Workers, D1, R2, Queues and billing built in.',
  url: 'https://app.example.com',
  /**
   * Turnstile is disabled until a real site key is provisioned. Set
   * VITE_TURNSTILE_SITE_KEY (and enable server verification in the API)
   * to turn the widget on.
   */
  turnstile: {
    enabled: false,
    siteKey: '',
  },
} as const

export type SiteConfig = typeof siteConfig
