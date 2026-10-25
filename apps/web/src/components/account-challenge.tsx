import { useEffect, useRef, useState } from 'react'
import { loadAccountTurnstile, mountAccountChallenge } from '~/lib/account-turnstile'

export function AccountChallenge({
  siteKey,
  onToken,
}: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    loadAccountTurnstile()
      .then((api) => {
        if (!disposed && container.current)
          cleanup = mountAccountChallenge(api, container.current, siteKey, onToken)
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Security verification unavailable. Reload to retry.',
          )
      })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [siteKey, onToken])
  return (
    <div className="space-y-2">
      <div ref={container} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
