import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FileToWrite {
  path: string
  content: string
  executable?: boolean
  ownerOnlyPerms?: boolean
}

export interface WriteOutcome {
  written: string[]
  skipped: string[]
}

export type ConfirmOverwrite = (path: string) => Promise<boolean>

/**
 * Writes files, never overwriting an existing file without confirmation.
 * Owner-only perms attempt (0o600) where the FS supports it.
 */
export async function writeFiles(
  root: string,
  files: FileToWrite[],
  confirm: ConfirmOverwrite = async () => false,
): Promise<WriteOutcome> {
  const outcome: WriteOutcome = { written: [], skipped: [] }
  for (const file of files) {
    const abs = join(root, file.path)
    if (existsSync(abs)) {
      const existing = readFileSync(abs, 'utf8')
      if (existing === file.content) {
        outcome.skipped.push(file.path)
        continue
      }
      const ok = await confirm(file.path)
      if (!ok) {
        outcome.skipped.push(file.path)
        continue
      }
    }
    const dir = join(abs, '..')
    mkdirSync(dir, { recursive: true })
    writeFileSync(abs, file.content, {
      flag: existsSync(abs) ? 'w' : 'wx',
      mode: file.ownerOnlyPerms ? 0o600 : 0o644,
    })
    if (file.ownerOnlyPerms) {
      try {
        chmodSync(abs, 0o600)
      } catch {
        // FS may not support POSIX perms (Windows); best effort only.
      }
    }
    if (file.executable) {
      try {
        chmodSync(abs, 0o755)
      } catch {
        // best effort
      }
    }
    outcome.written.push(file.path)
  }
  return outcome
}
