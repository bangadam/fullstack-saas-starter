import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { useProject } from '~/lib/projects'

export const Route = createFileRoute('/dashboard/projects/$id')({
  component: ProjectDetailPage,
})

function ProjectDetailPage() {
  const { id } = Route.useParams()
  const projectQuery = useProject(id)

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/dashboard/projects">
          <ArrowLeft />
          Back to projects
        </Link>
      </Button>

      {projectQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40" />
        </div>
      ) : projectQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Project not available</CardTitle>
            <CardDescription>
              {projectQuery.error instanceof Error
                ? projectQuery.error.message
                : 'The project could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void projectQuery.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{projectQuery.data.name}</h1>
            <p className="text-muted-foreground">
              {projectQuery.data.description ?? 'No description'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>Project metadata</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">ID:</span>{' '}
                  <code className="rounded bg-muted px-1 py-0.5">{projectQuery.data.id}</code>
                </p>
                <p>
                  <span className="text-muted-foreground">Created:</span>{' '}
                  {new Date(projectQuery.data.createdAt).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription>Coming with the API Worker</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Audit events and file activity will appear here once the API endpoints are wired
                  up.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
