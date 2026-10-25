import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { getApiClient } from '~/lib/api-client'
import {
  billingAccessMessage,
  billingErrorMessage,
  billingQueryKey,
  billingReturnUrl,
  billingStatusLabels,
  formatBillingBytes,
} from '~/lib/billing'

export const Route = createFileRoute('/dashboard/settings/billing')({
  component: BillingSettingsPage,
})

const plans = [
  {
    name: 'Free',
    id: 'free' as const,
    price: '$0',
    period: '/mo',
    features: ['Up to 3 projects', 'Community support'],
  },
  {
    name: 'Pro',
    id: 'pro' as const,
    price: '$20',
    period: '/mo',
    features: ['Unlimited projects', 'File uploads up to 25 MB', 'Priority support'],
  },
]

function BillingSettingsPage() {
  const queryClient = useQueryClient()
  const subscription = useQuery({
    queryKey: billingQueryKey,
    // No relative fetch from workerd during SSR. The server renders the same
    // loading state; hydration/client navigation performs the cookie-bound read.
    enabled: typeof window !== 'undefined',
    queryFn: () => getApiClient().getSubscription(),
  })
  const action = useMutation({
    mutationFn: async (kind: 'checkout' | 'portal' | 'refresh') => {
      const client = getApiClient()
      if (kind === 'refresh') {
        const data = await client.refreshSubscription()
        queryClient.setQueryData(billingQueryKey, data)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['projects'] }),
          queryClient.invalidateQueries({ queryKey: ['files'] }),
        ])
        toast.success('Subscription refreshed')
        return
      }
      const returnUrl = billingReturnUrl(window.location.origin)
      const result =
        kind === 'portal'
          ? await client.createCustomerPortal({ returnUrl })
          : await client.createCheckout({
              plan: 'pro',
              interval: 'monthly',
              successUrl: returnUrl,
              cancelUrl: returnUrl,
            })
      const destination = new URL(result.url)
      if (destination.protocol !== 'https:') throw new Error('Invalid billing destination')
      window.location.assign(destination.href)
    },
    onError: (error) => toast.error(billingErrorMessage(error)),
  })
  const data = subscription.data
  const currentPlan = data ? (data.plan === 'pro' ? 'Pro' : 'Free') : null
  const busy = action.isPending
  const sub = data?.subscription

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current subscription</CardTitle>
          <CardDescription>
            {currentPlan
              ? `Your account is on the ${currentPlan} plan.`
              : 'Review your plan, usage, and billing details.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {subscription.isPending ? (
            <output aria-label="Loading subscription">
              <Skeleton className="h-6 w-40" />
            </output>
          ) : subscription.isError ? (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Subscription details could not be loaded. Your plan has not changed.
              </p>
              <Button
                variant="outline"
                disabled={subscription.isFetching}
                onClick={() => void subscription.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{currentPlan}</Badge>
                {sub && <Badge variant="outline">{billingStatusLabels[sub.status]}</Badge>}
                {sub?.environment === 'sandbox' && <Badge variant="outline">Sandbox</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {billingAccessMessage(data.subscription, data.plan)}
              </p>
              {sub && (
                <p className="text-sm text-muted-foreground">
                  {sub.interval === 'yearly' ? 'Yearly' : 'Monthly'} billing via{' '}
                  {sub.provider === 'polar' ? 'Polar' : 'Stripe'}.
                </p>
              )}
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Projects</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {data.usage.projects} / {data.limits.maxProjects ?? 'Unlimited'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Storage used and reserved</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {formatBillingBytes(data.usage.storageBytes)} /{' '}
                    {formatBillingBytes(data.limits.maxStorageBytes)}
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                Manage payment details or cancel your subscription in the secure billing portal.
                Cancellation is confirmed there, not on this page. After returning, refresh your
                subscription to see the latest status.
              </p>
              {!data.portalAvailable && (
                <p className="text-sm text-muted-foreground">
                  The billing portal becomes available when a provider customer is linked to your
                  account.
                </p>
              )}
            </>
          ) : null}
          {action.isError && (
            <p role="alert" className="text-sm text-destructive">
              {billingErrorMessage(action.error)}
            </p>
          )}
        </CardContent>
        {data && !subscription.isError && (
          <CardFooter className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={busy || !data.portalAvailable}
              onClick={() => action.mutate('portal')}
            >
              {busy && action.variables === 'portal'
                ? 'Opening portal…'
                : 'Manage or cancel subscription'}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !data.refreshAvailable}
              onClick={() => action.mutate('refresh')}
            >
              {busy && action.variables === 'refresh' ? 'Refreshing…' : 'Refresh subscription'}
            </Button>
          </CardFooter>
        )}
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => {
          const isCurrent = plan.name === currentPlan
          return (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <p className="text-3xl font-bold">
                  {plan.price}
                  <span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {plan.id === 'pro' && (
                  <div className="w-full space-y-2">
                    <Button
                      className="w-full"
                      variant={isCurrent ? 'outline' : 'default'}
                      disabled={
                        busy || isCurrent || !data?.checkoutAvailable || subscription.isError
                      }
                      onClick={() => action.mutate('checkout')}
                    >
                      {busy && action.variables === 'checkout'
                        ? 'Opening checkout…'
                        : isCurrent
                          ? 'Current plan'
                          : 'Upgrade to Pro'}
                    </Button>
                    {data && !isCurrent && !data.checkoutAvailable && (
                      <p className="text-sm text-muted-foreground">
                        Checkout is unavailable. Use the billing portal for an existing subscription
                        or contact support.
                      </p>
                    )}
                  </div>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
