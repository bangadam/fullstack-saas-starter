import type { FileItem, FilesPage } from '@saas/contracts'
import { FilesApiError, createFilesClient } from '@saas/sdk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type { FileItem, FilesPage }
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}
export class DeleteFileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DeleteFileError'
  }
}
const client = () => createFilesClient({ baseUrl: '/api' })
export const fileKeys = { list: () => ['files', 'list'] as const }
export async function fetchFiles(): Promise<FilesPage> {
  return client().list()
}
export async function uploadFile(file: File): Promise<FileItem> {
  try {
    return await client().upload(file)
  } catch (error) {
    if (error instanceof FilesApiError) throw new UploadError(error.message, error.status)
    throw error
  }
}
export async function deleteFile(id: string): Promise<void> {
  try {
    await client().remove(id)
  } catch (error) {
    if (error instanceof FilesApiError) throw new DeleteFileError(error.message, error.status)
    throw error
  }
}
export async function downloadFile(id: string): Promise<void> {
  const { downloadUrl } = await client().downloadUrl(id)
  window.location.assign(downloadUrl)
}
export function useFiles() {
  return useQuery({ queryKey: fileKeys.list(), queryFn: fetchFiles })
}
export function useUploadFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadFile,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: fileKeys.list() })
    },
  })
}
export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteFile,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: fileKeys.list() })
    },
  })
}
