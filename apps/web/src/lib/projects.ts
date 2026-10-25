import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient } from './api-client'

export interface Project {
  id: string
  userId: string
  name: string
  description: string | null
  createdAt: string
}

export const projectKeys = {
  list: () => ['projects', 'list'] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
}

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: async () => {
      const client = getApiClient()
      return client.listProjects({ limit: 50, offset: 0 })
    },
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: async (): Promise<Project> => {
      const client = getApiClient()
      return client.getProject(id)
    },
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const client = getApiClient()
      return client.createProject(input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list() })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string | null }) => {
      const client = getApiClient()
      return client.updateProject(input.id, { name: input.name, description: input.description })
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list() })
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(input.id) })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const client = getApiClient()
      return client.deleteProject(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list() })
    },
  })
}
