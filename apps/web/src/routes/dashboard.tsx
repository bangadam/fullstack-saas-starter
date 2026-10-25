import { useMutation } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  CreditCard,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Settings,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Separator } from '~/components/ui/separator'
import { signOut } from '~/lib/auth-client'
import { fetchSession } from '~/lib/session'
import { readSessionOnServer } from '~/lib/session-gate'
import { siteConfig } from '~/lib/site-config'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    // Session gate. On the server the probe needs the incoming request's
    // cookies and origin, which only the server-function handler can reach —
    // see session-gate.ts for why @tanstack/react-start/server must not be
    // imported here. On the client, cookies ride along with the same-origin
    // fetch automatically.
    const session =
      typeof window === 'undefined' ? await readSessionOnServer() : await fetchSession()
    if (!session) {
      throw redirect({ to: '/login' })
    }
    return { session }
  },
  component: DashboardLayout,
})

const navItems: Array<{
  to: '/dashboard' | '/dashboard/projects' | '/dashboard/files' | '/dashboard/settings'
  label: string
  icon: typeof LayoutDashboard
  exact?: boolean
}> = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { to: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { to: '/dashboard/files', label: 'Files', icon: HardDrive },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
]

function useSignOut() {
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => signOut(),
    onSuccess: () => {
      void navigate({ to: '/login', replace: true })
    },
  })
}

function DashboardLayout() {
  const { session } = Route.useRouteContext()
  const signOutMutation = useSignOut()
  const handleSignOut = () => {
    signOutMutation.mutate()
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="flex h-16 items-center px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              S
            </span>
            {siteConfig.name}
          </Link>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <Button key={item.to} variant="ghost" className="w-full justify-start" asChild>
              <Link
                to={item.to}
                activeProps={{ className: 'bg-accent text-accent-foreground' }}
                activeOptions={item.exact ? { exact: true } : undefined}
              >
                <item.icon />
                {item.label}
              </Link>
            </Button>
          ))}
          <Button variant="ghost" className="w-full justify-start" asChild>
            <Link to="/dashboard/settings/billing">
              <CreditCard />
              Billing
            </Link>
          </Button>
        </nav>
        <Separator />
        <div className="p-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground"
            onClick={handleSignOut}
            disabled={signOutMutation.isPending}
          >
            <LogOut />
            {signOutMutation.isPending ? 'Signing out…' : 'Log out'}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b px-6 md:hidden">
          <Link to="/dashboard" className="font-semibold">
            {siteConfig.name}
          </Link>
          <UserMenu
            name={session.name}
            email={session.email}
            onSignOut={handleSignOut}
            signingOut={signOutMutation.isPending}
          />
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>

      <div className="fixed right-4 top-4 hidden md:block">
        <UserMenu
          name={session.name}
          email={session.email}
          onSignOut={handleSignOut}
          signingOut={signOutMutation.isPending}
        />
      </div>
    </div>
  )
}

function UserMenu({
  name,
  email,
  onSignOut,
  signingOut,
}: {
  name: string
  email: string
  onSignOut: () => void
  signingOut: boolean
}) {
  const initials = name
    ? name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 w-9 rounded-full p-0">
          <Avatar>
            <AvatarFallback>{initials || 'U'}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{name || 'Signed in'}</p>
          <p className="text-xs font-normal text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings/billing">Billing</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={cn('text-destructive')}
          onClick={onSignOut}
          disabled={signingOut}
        >
          <LogOut />
          {signingOut ? 'Signing out…' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
