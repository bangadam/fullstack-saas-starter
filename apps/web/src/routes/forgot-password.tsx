import { zodResolver } from '@hookform/resolvers/zod'
import { Link, createFileRoute } from '@tanstack/react-router'
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
import { AuthError, requestPasswordReset } from '~/lib/auth-client'
import { siteConfig } from '~/lib/site-config'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

const schema = z.object({ email: z.string().email() })
type ForgotInput = z.infer<typeof schema>

function ForgotPasswordPage() {
  const form = useForm<ForgotInput>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })
  const sent = form.formState.isSubmitSuccessful

  async function onSubmit(values: ForgotInput) {
    try {
      // Always lands on success: the API never reveals whether the account
      // exists, and neither should this screen.
      await requestPasswordReset({ email: values.email, redirectTo: '/reset-password' })
      toast.success('Check your email for the reset link')
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
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription>
            We will email you a single-use link to set a new {siteConfig.name} password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                If an account exists for that email, a reset link is on its way. The link expires
                shortly and can only be used once.
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/login">Back to log in</Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          autoComplete="email"
                          {...field}
                        />
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
                  {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            </Form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Remembered it?{' '}
            <Link to="/login" className="font-medium underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
