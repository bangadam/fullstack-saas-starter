import { zodResolver } from '@hookform/resolvers/zod'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '~/components/ui/form'
import { Input } from '~/components/ui/input'
import { AuthError, resetPassword } from '~/lib/auth-client'

/**
 * Landing page for the reset link. Better Auth's callback redirects here with
 * `?token=...`, so the token is read from the URL and posted back with the new
 * password. A missing token means the visitor opened the page directly.
 */
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === 'string' && search.token.length > 0 ? search.token : undefined,
  }),
  component: ResetPasswordPage,
})

const schema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters').max(128),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
type ResetInput = z.infer<typeof schema>

function ResetPasswordPage() {
  const navigate = useNavigate()
  const { token } = Route.useSearch()

  const form = useForm<ResetInput>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })

  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Reset link needed</CardTitle>
            <CardDescription>
              This page needs the link we emailed you. Request a new one to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" asChild>
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  async function onSubmit(values: ResetInput) {
    try {
      await resetPassword({ token: token as string, newPassword: values.password })
      toast.success('Password updated — log in with your new password')
      await navigate({ to: '/login' })
    } catch (err) {
      form.setError('root', {
        message: err instanceof AuthError ? err.message : 'Network error. Is the API running?',
      })
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>Choose a password you have not used before.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {form.formState.errors.root.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Update password'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  )
}
