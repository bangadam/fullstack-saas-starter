import { Link, createFileRoute } from '@tanstack/react-router'
import { Check } from 'lucide-react'
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
import { siteConfig } from '~/lib/site-config'

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
})

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    description: 'Everything to validate your idea.',
    features: ['1 personal account', '3 projects', 'Community support', 'Background jobs'],
    cta: 'Start for free',
  },
  {
    name: 'Pro',
    price: '$20',
    period: '/mo',
    description: 'For growing teams that need room.',
    features: [
      'Unlimited projects',
      'Role-based access control',
      'Billing portal',
      'Priority support',
      'Audit events',
    ],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    name: 'Annual Pro',
    price: '$200',
    period: '/yr',
    description: 'Two months free, billed yearly.',
    features: ['Everything in Pro', 'Two months free', 'Invoice billing'],
    cta: 'Upgrade to Pro',
  },
]

function PricingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              S
            </span>
            {siteConfig.name}
          </Link>
          <Button variant="ghost" asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="mb-12 text-center">
            <h1 className="mb-2 text-4xl font-bold tracking-tight">Pricing</h1>
            <p className="text-muted-foreground">
              Prices are placeholders pending final plan configuration.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {plans.map((plan) => (
              <Card
                key={plan.name}
                className={plan.highlighted ? 'border-primary shadow-lg' : undefined}
              >
                <CardHeader>
                  {plan.highlighted && <Badge className="w-fit">Most popular</Badge>}
                  <CardTitle>{plan.name}</CardTitle>
                  <p className="text-4xl font-bold">
                    {plan.price}
                    <span className="text-base font-normal text-muted-foreground">
                      {plan.period}
                    </span>
                  </p>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={plan.highlighted ? 'default' : 'outline'}
                    asChild
                  >
                    <Link to="/signup">{plan.cta}</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
