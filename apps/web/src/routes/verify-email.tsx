import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { siteConfig } from '~/lib/site-config'

/**
 * Email verification landing page.
 *
 * Two ways in:
 *  - the verification email link goes straight to the API endpoint, which
 *    redirects here with `?status=verified`;
 *  - a visitor arriving with `?token=` (for example from a link copied out of
 *    the email) is sent through that same API endpoint so verification still
 *    happens server-side.
 */
export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { status?: string; token?: string } => ({
    status: typeof search.status === 'string' ? search.status : undefined,
    token: typeof search.token === 'string' && search.token.length > 0 ? search.token : undefined,
  }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { status, token } = Route.useSearch()
  const [forwarded, setForwarded] = useState(false)

  useEffect(() => {
    if (!token || forwarded) return
    setForwarded(true)
    // Full navigation on purpose: the API endpoint answers with a redirect to
    // the callback URL, and the browser must follow it.
    window.location.replace(
      `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(
        '/verify-email?status=verified',
      )}`,
    )
  }, [token, forwarded])

  const verified = status === 'verified'
  const failed = status === 'invalid'

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            {verified ? 'Email verified' : failed ? 'Link expired' : 'Verifying your email'}
          </CardTitle>
          <CardDescription>
            {verified
              ? `Thanks — your ${siteConfig.name} account is fully activated.`
              : failed
                ? 'This verification link is invalid or has already been used.'
                : 'Hold on while we confirm your email address.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {verified ? (
            <Button className="w-full" asChild>
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          ) : failed ? (
            <Button className="w-full" asChild>
              <Link to="/dashboard/settings">Request a new link</Link>
            </Button>
          ) : null}
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="font-medium underline-offset-4 hover:underline">
              Back to log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
