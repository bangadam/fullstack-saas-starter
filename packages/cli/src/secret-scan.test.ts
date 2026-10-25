import { describe, expect, it } from 'vitest'
import { findSecrets, isPlaceholderSecret } from './secret-scan'

const file = (path: string, content: string) => ({ path, content })

describe('isPlaceholderSecret', () => {
  it('treats empty, example and dev-only values as safe', () => {
    expect(isPlaceholderSecret('')).toBe(true)
    expect(isPlaceholderSecret('   ')).toBe(true)
    expect(isPlaceholderSecret('your-token-here')).toBe(true)
    expect(isPlaceholderSecret('dev-only-secret-replace-me-0123456789abcdef')).toBe(true)
    expect(isPlaceholderSecret('<redacted>')).toBe(true)
    expect(isPlaceholderSecret('changeme')).toBe(true)
  })

  it('does not treat a random long value as a placeholder', () => {
    expect(isPlaceholderSecret('cfut_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false)
  })
})

describe('findSecrets', () => {
  it('flags a Cloudflare API token in an example env file', () => {
    const findings = findSecrets([
      file('.env.example', 'CLOUDFLARE_API_TOKEN=cfut_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n'),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.path).toBe('.env.example')
    expect(findings[0]?.line).toBe(1)
    expect(findings[0]?.rule).toBe('cloudflare-token')
    // The finding must never echo the secret itself.
    expect(JSON.stringify(findings)).not.toContain('RERUGG')
  })

  it('flags provider secret keys (Stripe, Resend, AWS, private keys)', () => {
    const findings = findSecrets([
      file('a.txt', 'STRIPE_SECRET_KEY=sk_live_51H8xAbCdEfGhIjKlMnOp\n'),
      file('b.ts', 'const key = "re_12345678901234567890123456789012"\n'),
      file('c.yml', 'aws_access_key_id: AKIAIOSFODNN7EXAMPLE\n'),
      file('d.pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n'),
    ])
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'aws-access-key',
      'private-key',
      'resend-key',
      'stripe-live-key',
    ])
  })

  it('ignores placeholders, empty assignments and comments', () => {
    const findings = findSecrets([
      file('.env.example', 'STRIPE_SECRET_KEY=\nPOLAR_ACCESS_TOKEN=your-token-here\n'),
      file('docs.md', '# CLOUDFLARE_API_TOKEN=cfut_example_only\n'),
      file('code.ts', "if (key === 'sk_live_placeholder') return\n"),
    ])
    expect(findings).toEqual([])
  })

  it('skips test fixtures and lockfiles by path', () => {
    const findings = findSecrets([
      file(
        'packages/foo/src/secret-scan.test.ts',
        'CLOUDFLARE_API_TOKEN=cfut_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n',
      ),
      file('pnpm-lock.yaml', 'integrity: cfut_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n'),
      file('node_modules/x/index.js', 'CLOUDFLARE_API_TOKEN=cfut_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n'),
    ])
    expect(findings).toEqual([])
  })

  it('reports every occurrence with its 1-based line number', () => {
    const findings = findSecrets([
      file(
        'secrets.env',
        [
          '# comment',
          'A=1',
          'CLOUDFLARE_API_TOKEN=cfut_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          'B=2',
        ].join('\n'),
      ),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.line).toBe(3)
  })
})
