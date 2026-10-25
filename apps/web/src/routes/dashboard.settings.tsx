import { Link, Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and billing.</p>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link
          to="/dashboard/settings"
          activeProps={{ className: 'font-semibold text-foreground' }}
          className="text-muted-foreground hover:text-foreground"
        >
          Account
        </Link>
        <Link
          to="/dashboard/settings/billing"
          activeProps={{ className: 'font-semibold text-foreground' }}
          className="text-muted-foreground hover:text-foreground"
        >
          Billing
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
