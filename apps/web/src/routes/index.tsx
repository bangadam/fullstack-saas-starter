import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Check, Cloud, Database, Gauge, Lock, Zap } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { siteConfig } from '~/lib/site-config'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

const features = [
  {
    icon: Cloud,
    title: 'Cloudflare-native',
    description: 'Workers, D1, R2 and Queues. No servers to manage, scale included.',
  },
  {
    icon: Lock,
    title: 'Auth & personal accounts',
    description: 'Email/password, OAuth, invitations and role-based access out of the box.',
  },
  {
    icon: Database,
    title: 'Typed end to end',
    description: 'Zod contracts and a generated SDK keep frontend and backend in sync.',
  },
  {
    icon: Gauge,
    title: 'Billing built in',
    description: 'Polar and Stripe adapters with subscription plans and entitlements.',
  },
  {
    icon: Zap,
    title: 'Background jobs',
    description: 'Queues consumers and cron triggers with retries and DLQ.',
  },
  {
    icon: Check,
    title: 'Production hygiene',
    description: 'Audit events, webhooks with signature verification, redacted secrets.',
  },
]

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    description: 'Everything to validate your idea.',
    features: ['1 personal account', '3 projects', 'Community support'],
  },
  {
    name: 'Pro',
    price: '$20',
    period: '/mo',
    description: 'For growing teams.',
    features: ['Unlimited projects', 'Role-based access', 'Priority support', 'Billing portal'],
  },
]

function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Features />
        <PricingPreview />
      </main>
      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            S
          </span>
          {siteConfig.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            to="/pricing"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Pricing
          </Link>
          <Button variant="ghost" asChild>
            <Link to="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Get started</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-24 text-center">
        <Badge variant="secondary">Cloudflare-native boilerplate</Badge>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {siteConfig.tagline}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{siteConfig.description}</p>
        <div className="flex gap-3">
          <Button size="lg" asChild>
            <Link to="/signup">
              Start for free <ArrowRight />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/pricing">View pricing</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="border-b">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight">
          Everything you need, nothing you don't
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <feature.icon className="mb-2 h-6 w-6 text-primary" />
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function PricingPreview() {
  return (
    <section>
      <div className="mx-auto w-full max-w-4xl px-6 py-20 text-center">
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Simple, transparent pricing</h2>
        <p className="mb-10 text-muted-foreground">Start free. Upgrade when your team grows.</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {plans.map((plan) => (
            <Card key={plan.name}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <p className="text-4xl font-bold">
                  {plan.price}
                  <span className="text-base font-normal text-muted-foreground">{plan.period}</span>
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
                <Button
                  className="mt-6 w-full"
                  variant={plan.name === 'Pro' ? 'default' : 'outline'}
                  asChild
                >
                  <Link to="/signup">Choose {plan.name}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <p>
          © {new Date().getFullYear()} {siteConfig.name}
        </p>
        <div className="flex gap-4">
          <Link to="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link to="/login" className="hover:text-foreground">
            Log in
          </Link>
          <Link to="/signup" className="hover:text-foreground">
            Sign up
          </Link>
        </div>
      </div>
    </footer>
  )
}
