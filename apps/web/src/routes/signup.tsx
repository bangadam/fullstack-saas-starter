import { zodResolver } from '@hookform/resolvers/zod'
import { type SignUpInput, signUpSchema } from '@saas/contracts'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { TurnstilePlaceholder } from '~/components/turnstile-placeholder'
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
import { AuthError, signUp } from '~/lib/auth-client'
import { siteConfig } from '~/lib/site-config'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
})

function SignupPage() {
  const navigate = useNavigate()

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', name: '' },
  })

  async function onSubmit(values: SignUpInput) {
    try {
      await signUp(values)
      toast.success('Account created — check your email to verify')
      await navigate({ to: '/dashboard' })
    } catch (err) {
      form.setError('root', {
        message:
          err instanceof AuthError ? err.message : 'Network error. Is the API Worker running?',
      })
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Create your {siteConfig.name} account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Ada Lovelace" autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <TurnstilePlaceholder />
              {form.formState.errors.root && (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {form.formState.errors.root.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating account…' : 'Sign up'}
              </Button>
            </form>
          </Form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="font-medium underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
