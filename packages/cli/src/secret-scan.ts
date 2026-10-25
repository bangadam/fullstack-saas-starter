/**
 * Secret scanner for tracked files.
 *
 * Catches the class of mistake that matters most in a template repo: a real
 * credential pasted into a committed example/config file. Findings never
 * echo the secret itself — only path, line and rule.
 */

export interface ScannedFile {
  path: string
  content: string
}

export interface SecretFinding {
  path: string
  line: number
  rule: string
}

interface Rule {
  id: string
  pattern: RegExp
}

const RULES: Rule[] = [
  { id: 'cloudflare-token', pattern: /\bcfut_[A-Za-z0-9_-]{20,}/ },
  { id: 'stripe-live-key', pattern: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { id: 'stripe-restricted-key', pattern: /\brk_live_[A-Za-z0-9]{16,}/ },
  { id: 'resend-key', pattern: /\bre_[A-Za-z0-9]{24,}/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
]

/** Paths that legitimately contain token-shaped fixtures. */
const SKIPPED_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /\.test\.[cm]?[jt]sx?$/,
  /(^|\/)dist\//,
  /(^|\/)\.wrangler\//,
]

/** Values that are obviously placeholders, not credentials. */
const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^<.*>$/,
  /your[-_ ]?token/i,
  /replace[-_ ]?me/i,
  /dev[-_ ]only/i,
  /^example/i,
  /placeholder/i,
  /^changeme$/i,
  /^xxx+$/i,
  /^\$\{.*\}$/,
]

/** A whole assignment value (after `KEY=`) counts as a placeholder when it matches. */
export function isPlaceholderSecret(value: string): boolean {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function shouldSkip(path: string): boolean {
  return SKIPPED_PATH_PATTERNS.some((pattern) => pattern.test(path))
}

/** Returns the assigned value on a `KEY=value` / `KEY: value` line, if any. */
function assignedValue(line: string): string | null {
  const match = /^[^=:#\s][^=:]*[=:]\s*(.*)$/.exec(line.trim())
  return match ? (match[1] ?? '') : null
}

export function findSecrets(files: ScannedFile[]): SecretFinding[] {
  const findings: SecretFinding[] = []

  for (const file of files) {
    if (shouldSkip(file.path)) continue

    const lines = file.content.split('\n')
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim()
      // Comments never ship a credential, and scanning them creates noise in
      // docs that quote a token format.
      if (line.startsWith('#') || line.startsWith('//')) continue

      for (const rule of RULES) {
        const match = rule.pattern.exec(line)
        if (!match) continue
        const value = assignedValue(line)
        if (value !== null && isPlaceholderSecret(value)) continue
        findings.push({ path: file.path, line: index + 1, rule: rule.id })
      }
    }
  }

  return findings
}

/** Formats findings for terminal output without leaking values. */
export function formatFindings(findings: SecretFinding[]): string {
  if (findings.length === 0) return 'No secrets found in scanned files.'
  const lines = findings.map((f) => `  ${f.path}:${f.line} — ${f.rule}`)
  return [
    `Found ${findings.length} potential secret(s):`,
    ...lines,
    '',
    'Rotate the credential, then remove it from the file and from git history.',
  ].join('\n')
}
