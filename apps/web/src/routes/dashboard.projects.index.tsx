import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Skeleton } from '~/components/ui/skeleton'
import { useCreateProject, useProjects } from '~/lib/projects'

export const Route = createFileRoute('/dashboard/projects/')({
  component: ProjectsPage,
})

function NewProjectDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const createProject = useCreateProject()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      toast.success(`Project "${name.trim()}" created`)
      setOpen(false)
      setName('')
      setDescription('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project'
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Projects are private to your account. Free plan allows up to 3 active projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-description">Description (optional)</Label>
            <Input
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectsPage() {
  const projectsQuery = useProjects()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">Projects in your account.</p>
        </div>
        <NewProjectDialog />
      </div>

      {projectsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {['a', 'b', 'c'].map((key) => (
            <Skeleton key={key} className="h-32" />
          ))}
        </div>
      ) : projectsQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium">Failed to load projects</p>
            <p className="text-sm text-muted-foreground">
              {projectsQuery.error instanceof Error
                ? projectsQuery.error.message
                : 'The API Worker may not be reachable yet.'}
            </p>
            <Button variant="outline" onClick={() => void projectsQuery.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : projectsQuery.data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first project to get started.
            </p>
            <NewProjectDialog />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectsQuery.data.items.map((project) => (
            <Link
              key={project.id}
              to="/dashboard/projects/$id"
              params={{ id: project.id }}
              className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <p className="font-semibold">{project.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {project.description ?? 'No description'}
                  </p>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
