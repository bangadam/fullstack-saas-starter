import { useQuery } from '@tanstack/react-query'
import { type SessionInfo, fetchSession } from './session'

export const sessionQueryKey = ['auth', 'session'] as const

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => fetchSession(),
    staleTime: 60_000,
  })
}

export type { SessionInfo }
