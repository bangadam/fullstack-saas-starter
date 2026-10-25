export interface AccountTurnstile {
  render(
    element: HTMLElement,
    options: {
      sitekey: string
      callback(token: string): void
      'expired-callback'(): void
      'error-callback'(): void
      theme: 'auto'
      size: 'flexible'
    },
  ): string
  remove(id: string): void
}
export function mountAccountChallenge(
  api: AccountTurnstile,
  element: HTMLElement,
  sitekey: string,
  onToken: (token: string) => void,
) {
  const id = api.render(element, {
    sitekey,
    callback: onToken,
    'expired-callback': () => onToken(''),
    'error-callback': () => onToken(''),
    theme: 'auto',
    size: 'flexible',
  })
  return () => {
    api.remove(id)
    onToken('')
  }
}
let loading: Promise<AccountTurnstile> | undefined
export function loadAccountTurnstile(): Promise<AccountTurnstile> {
  const host = window as Window & { turnstile?: AccountTurnstile }
  if (host.turnstile) return Promise.resolve(host.turnstile)
  if (!loading)
    loading = new Promise<AccountTurnstile>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.onload = () =>
        host.turnstile
          ? resolve(host.turnstile)
          : reject(new Error('Security verification unavailable. Reload to retry.'))
      script.onerror = () => {
        loading = undefined
        script.remove()
        reject(new Error('Could not load security verification. Check your connection and reload.'))
      }
      document.head.appendChild(script)
    })
  return loading
}
