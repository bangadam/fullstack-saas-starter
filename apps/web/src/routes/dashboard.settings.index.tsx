import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { AccountChallenge } from '~/components/account-challenge'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Skeleton } from '~/components/ui/skeleton'
import {
  accountClient,
  changeAccountPassword,
  deleteAccount,
  downloadAccountData,
  updateAccountName,
} from '~/lib/account'
import { sendVerificationEmail } from '~/lib/auth-client'
import { sessionQueryKey, useSession } from '~/lib/use-session'

export const Route = createFileRoute('/dashboard/settings/')({ component: AccountSettingsPage })
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not complete this action. Please try again.'

function AccountSettingsPage() {
  const session = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [token, setToken] = useState('')
  const [challengeKey, setChallengeKey] = useState(0)
  const [notice, setNotice] = useState('')
  const enabled = Boolean(session.data)
  const sessions = useQuery({
    queryKey: ['account', 'sessions'],
    queryFn: accountClient.listSessions,
    enabled,
  })
  const deletion = useQuery({
    queryKey: ['account', 'deletion'],
    queryFn: accountClient.deletionState,
    enabled,
  })
  const security = useQuery({
    queryKey: ['account', 'security'],
    queryFn: accountClient.security,
    enabled,
  })
  const failure = (error: unknown) => {
    setNotice(errorMessage(error))
    toast.error(errorMessage(error))
  }
  const refreshChallenge = () => {
    setToken('')
    setChallengeKey((key) => key + 1)
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['account'] })
  const saveName = useMutation({
    mutationFn: () => updateAccountName(name ?? session.data?.name ?? ''),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
      toast.success('Name updated')
      setNotice('Name updated.')
    },
    onError: failure,
  })
  const resend = useMutation({
    mutationFn: () => sendVerificationEmail({ callbackURL: '/verify-email?status=verified' }),
    onSuccess: () => toast.success('Verification email sent — check your inbox'),
    onError: failure,
  })
  const password = useMutation({
    mutationFn: () => changeAccountPassword(currentPassword, newPassword, token),
    onSuccess: async () => {
      setCurrentPassword('')
      setNewPassword('')
      await refresh()
      setNotice('Password changed. Other sessions have been signed out.')
      toast.success('Password changed; other sessions signed out')
    },
    onError: failure,
    onSettled: refreshChallenge,
  })
  const revoke = useMutation({
    mutationFn: accountClient.revokeSession,
    onSuccess: async () => {
      await refresh()
      toast.success('Session revoked')
    },
    onError: failure,
  })
  const exportData = useMutation({
    mutationFn: accountClient.exportData,
    onSuccess: (data) => {
      downloadAccountData(data)
      toast.success('Account data downloaded')
    },
    onError: failure,
  })
  const prepare = useMutation({
    mutationFn: () => accountClient.prepareDeletion(confirmation),
    onSuccess: async () => {
      await refresh()
      setNotice(
        'Deletion prepared. Uploads and new checkouts are paused. Return after the displayed time to finish.',
      )
    },
    onError: failure,
  })
  const remove = useMutation({
    mutationFn: () => deleteAccount(confirmation, deletePassword, token),
    onSuccess: () => {
      queryClient.clear()
      window.location.assign('/login')
    },
    onError: failure,
    onSettled: () => {
      setDeletePassword('')
      refreshChallenge()
    },
  })
  const sensitiveReady =
    security.isSuccess &&
    (!security.data.turnstileRequired || Boolean(security.data.turnstileSiteKey && token))
  const prepared = Boolean(deletion.data?.preparedAt)

  if (session.isPending) return <Skeleton className="h-40 w-full" />
  if (!session.data)
    return (
      <p className="text-sm text-muted-foreground">Session unavailable. Reload or sign in again.</p>
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Manage your profile, security and personal data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <output aria-live="polite" className="block text-sm">
          {notice}
        </output>
        <section className="space-y-4" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="text-base font-semibold">
            Profile
          </h2>
          <form
            className="max-w-lg space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              saveName.mutate()
            }}
          >
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              autoComplete="name"
              value={name ?? session.data.name ?? ''}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
            />
            <Button
              type="submit"
              disabled={saveName.isPending || !(name ?? session.data.name)?.trim()}
            >
              {saveName.isPending ? 'Saving…' : 'Save name'}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="break-all">{session.data.email}</span>
            <Badge variant={session.data.emailVerified ? 'secondary' : 'destructive'}>
              {session.data.emailVerified ? 'Verified' : 'Unverified'}
            </Badge>
          </div>
          {!session.data.emailVerified && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Verify your email to secure your account and enable password recovery.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resend.mutate()}
                disabled={resend.isPending}
              >
                {resend.isPending ? 'Sending…' : 'Resend verification email'}
              </Button>
            </div>
          )}
        </section>
        <section className="space-y-4 border-t pt-6" aria-labelledby="security-heading">
          <h2 id="security-heading" className="text-base font-semibold">
            Password and security
          </h2>
          <p className="text-sm text-muted-foreground">
            Changing your password signs out every other session. Accounts created with Google can
            set a password through password recovery first.
          </p>
          {security.isError && (
            <p role="alert" className="text-sm text-destructive">
              Security settings could not load.{' '}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => security.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {security.data?.turnstileRequired &&
            (security.data.turnstileSiteKey ? (
              <AccountChallenge
                key={challengeKey}
                siteKey={security.data.turnstileSiteKey}
                onToken={setToken}
              />
            ) : (
              <p role="alert" className="text-sm text-destructive">
                Security verification is unavailable. Contact support before changing your password
                or deleting your account.
              </p>
            ))}
          <form
            className="max-w-lg space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              password.mutate()
            }}
          >
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
            <p className="text-xs text-muted-foreground">Use 8–128 characters.</p>
            <Button
              type="submit"
              disabled={password.isPending || remove.isPending || !sensitiveReady}
            >
              {password.isPending ? 'Changing password…' : 'Change password'}
            </Button>
          </form>
        </section>
        <section className="space-y-3 border-t pt-6" aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className="text-base font-semibold">
            Active sessions
          </h2>
          {sessions.isPending ? (
            <p className="text-sm text-muted-foreground">Loading sessions…</p>
          ) : sessions.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load sessions.{' '}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => sessions.refetch()}
              >
                Retry
              </button>
            </p>
          ) : !sessions.data.items.length ? (
            <p className="text-sm text-muted-foreground">No active sessions found.</p>
          ) : (
            <ul className="divide-y">
              {sessions.data.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-sm">{item.userAgent || 'Unknown device'}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.ipAddress || 'IP unavailable'} · Started{' '}
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {item.current ? (
                    <Badge variant="secondary">This session</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(item.id)}
                    >
                      {revoke.isPending && revoke.variables === item.id
                        ? 'Revoking…'
                        : 'Revoke session'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3 border-t pt-6" aria-labelledby="data-heading">
          <h2 id="data-heading" className="text-base font-semibold">
            Your data
          </h2>
          <p className="text-sm text-muted-foreground">
            Download your profile, projects, file metadata, subscriptions and audit history as JSON.
            File contents, credentials, session tokens and internal audit metadata are not included.
          </p>
          <Button
            variant="outline"
            disabled={exportData.isPending}
            onClick={() => exportData.mutate()}
          >
            {exportData.isPending ? 'Preparing download…' : 'Download account data'}
          </Button>
        </section>
        <section className="space-y-4 border-t pt-6" aria-labelledby="delete-heading">
          <h2 id="delete-heading" className="text-base font-semibold text-destructive">
            Delete account
          </h2>
          <p className="text-sm text-muted-foreground">
            Deletion permanently removes your account, projects and files. Download your data first.
            Cancel subscriptions in Billing and wait for cancellation to take effect. Pending
            checkout attempts may need support reconciliation.
          </p>
          <p className="text-sm text-muted-foreground">
            Preparation pauses uploads and new checkouts immediately and cannot be undone here.
            Existing uploads need at least 70 minutes to drain. Return after that time and enter
            your password to finish. If cleanup fails, your account stays in place for retry.
          </p>
          {deletion.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not load deletion status.{' '}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => deletion.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {prepared && (
            <output className="block text-sm font-medium">
              Uploads and checkout are paused. Finish deletion after{' '}
              {deletion.data?.retryAfter
                ? new Date(deletion.data.retryAfter).toLocaleString()
                : 'the upload drain period'}
              .
            </output>
          )}
          <form
            className="max-w-lg space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (prepared) remove.mutate()
              else prepare.mutate()
            }}
          >
            <Label htmlFor="delete-confirmation">Type DELETE to confirm</Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              required
              pattern="DELETE"
            />
            {prepared && (
              <>
                <Label htmlFor="delete-password">Current password</Label>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                />
              </>
            )}
            <Button
              type="submit"
              variant="destructive"
              disabled={
                confirmation !== 'DELETE' ||
                !deletion.isSuccess ||
                prepare.isPending ||
                remove.isPending ||
                password.isPending ||
                (prepared && (!sensitiveReady || !deletePassword))
              }
            >
              {prepare.isPending
                ? 'Preparing…'
                : remove.isPending
                  ? 'Deleting…'
                  : prepared
                    ? 'Permanently delete account'
                    : 'Prepare account deletion'}
            </Button>
          </form>
        </section>
      </CardContent>
    </Card>
  )
}
