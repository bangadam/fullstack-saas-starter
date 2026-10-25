import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Activity, CreditCard, FolderKanban } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { useProjects } from '~/lib/projects'

export const Route = createFileRoute('/dashboard/')({
  component: DashboardIndexPage,
})

function DashboardIndexPage() {
  const projectsQuery = useProjects()
  const subscriptionQuery = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => {
      const res = await fetch('/api/billing/subscription')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      return (await res.json()) as { plan: string; status: string }
    },
  })
  const auditQuery = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: async () => {
      const res = await fetch('/api/audit?limit=5')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      return (await res.json()) as {
        items: Array<{ id: string; action: string; createdAt: string }>
      }
    },
  })

  const projectCount = projectsQuery.data ? `${projectsQuery.data.total}` : '—'
  const plan = subscriptionQuery.data ? subscriptionQuery.data.plan : '—'

  const stats = [
    { label: 'Projects', value: projectCount, icon: FolderKanban, note: 'your active projects' },
    { label: 'Plan', value: plan, icon: CreditCard, note: 'current subscription' },
    {
      label: 'Recent events',
      value: auditQuery.data ? `${auditQuery.data.items.length}` : '—',
      icon: Activity,
      note: 'latest account activity',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground">Here is an overview of your account.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold capitalize">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest actions on your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : auditQuery.isError || (auditQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity yet — create a project to get started.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {auditQuery.data.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4">
                  <span className="font-medium">{item.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/dashboard/projects">Go to projects</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/dashboard/settings/billing">Manage billing</Link>
        </Button>
      </div>
    </div>
  )
}
