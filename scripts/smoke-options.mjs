export function smokeOptions(env) {
  const url = new URL(env.SMOKE_BASE_URL ?? 'http://localhost:3000')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('SMOKE_BASE_URL must be an HTTP(S) origin without credentials, path or query')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const hasEmail = Boolean(env.SMOKE_EMAIL)
  const hasPassword = Boolean(env.SMOKE_PASSWORD)
  if (hasEmail !== hasPassword) throw new Error('Set both SMOKE_EMAIL and SMOKE_PASSWORD')
  if (hasEmail && !local && url.protocol !== 'https:')
    throw new Error('Remote credentials require HTTPS')
  const credentials = hasEmail
    ? { email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD }
    : local
      ? { email: 'sari@example.com', password: 'password123' }
      : null
  return { baseUrl: url.origin, credentials }
}
