import { createFileRoute } from '@tanstack/react-router'
import { Download, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import {
  DeleteFileError,
  UploadError,
  downloadFile,
  useDeleteFile,
  useFiles,
  useUploadFile,
} from '~/lib/files'

export const Route = createFileRoute('/dashboard/files')({
  component: FilesPage,
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ${units[index]}`
}

function FilesPage() {
  const filesQuery = useFiles()
  const upload = useUploadFile()
  const remove = useDeleteFile()
  const inputRef = useRef<HTMLInputElement>(null)

  function onPick(file: File | undefined) {
    if (!file) return
    upload.mutate(file, {
      onSuccess: () => toast.success(`${file.name} uploaded`),
      onError: (error) =>
        toast.error(error instanceof UploadError ? error.message : 'Upload failed. Try again.'),
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDelete(id: string, name: string) {
    remove.mutate(id, {
      onSuccess: () => toast.success(`${name} deleted`),
      onError: (error) =>
        toast.error(error instanceof DeleteFileError ? error.message : 'Delete failed'),
    })
  }

  const usedBytes = filesQuery.data?.usedBytes ?? 0
  const limitBytes = filesQuery.data?.limitBytes ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Files</h1>
          <p className="text-muted-foreground">
            {filesQuery.data
              ? `${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} used`
              : 'Private files in your account.'}
          </p>
          {(filesQuery.data?.reservedBytes ?? 0) > 0 && (
            <p className="max-w-prose text-sm text-muted-foreground">
              Includes {formatBytes(filesQuery.data?.reservedBytes ?? 0)} reserved for pending
              uploads or cleanup. Cancelled uploads release space after their upload link and safety
              window expire.
            </p>
          )}
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            id="file-upload"
            onChange={(event) => onPick(event.target.files?.[0])}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            <Upload />
            {upload.isPending ? 'Uploading…' : 'Upload file'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded files</CardTitle>
        </CardHeader>
        <CardContent>
          {filesQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : filesQuery.isError ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Failed to load files.</p>
              <Button variant="outline" onClick={() => void filesQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : filesQuery.data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No files yet — upload one to see it here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filesQuery.data.items.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="max-w-64 truncate font-medium" title={file.name}>
                      {file.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{file.contentType}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(file.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {file.status === 'completed' ? 'Ready' : 'Pending upload'}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={file.status !== 'completed'}
                        onClick={() =>
                          void downloadFile(file.id).catch(() => toast.error('Download failed'))
                        }
                      >
                        <Download />
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(file.id, file.name)}
                        disabled={remove.isPending}
                      >
                        <Trash2 />
                        {file.status === 'pending' ? 'Cancel upload' : 'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
