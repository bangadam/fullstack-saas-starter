import { z } from 'zod'

export const uploadRequestSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().min(3).max(255),
})

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>

export const fileItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  contentType: z.string(),
  status: z.enum(['pending', 'completed', 'expired', 'deleting']),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
})
export const filesPageSchema = z.object({
  items: z.array(fileItemSchema),
  usedBytes: z.number().nonnegative(),
  reservedBytes: z.number().nonnegative(),
  limitBytes: z.number().nonnegative(),
})
export const uploadTicketSchema = z.object({
  fileId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  mode: z.enum(['direct', 'presigned']),
  headers: z.record(z.string()),
  uploadExpiresAt: z.string(),
  expiresAt: z.string(),
})
export type FileItem = z.infer<typeof fileItemSchema>
export type FilesPage = z.infer<typeof filesPageSchema>
export type UploadTicket = z.infer<typeof uploadTicketSchema>
