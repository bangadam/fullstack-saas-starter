/**
 * Agent-driven end-to-end flows for the SaaS starter.
 *
 * This module has no test-runner dependency: it exports `runAllTests(tab)`,
 * driven from a ZCode browser session. It is the interactive counterpart of
 * `pnpm smoke` (CI-friendly HTTP checks without a browser). Do not run it
 * with plain `node` — it needs a browser `tab` object exposing the
 * `playwright` surface (`tabs.get()`, `goto`, `playwright.*`).
 *
 * Covered flows:
 *  1. login redirect      6a. billing plans
 *  2. dashboard layout    6b. upgrade error path (no provider locally)
 *  3a. projects page      7. log out button
 *  3b. create project     8. auth gate (signed-out /dashboard)
 *  4. project detail      9. signup redirect
 *  5. settings account
 *
 * Requires: `pnpm dev` running and a seeded DB (`pnpm bootstrap`).
 * Credentials are the seeded accounts (see scripts/seed.mjs).
 */

export const BASE = 'http://localhost:3000'
export const FREE_USER = { email: 'sari@example.com', password: 'password123' }

function verdict(results, name, pass, detail = '') {
  results.push({ name, pass, detail })
}

async function fillForm(tab, fields) {
  for (const [label, value] of Object.entries(fields)) {
    await tab.playwright.getByRole('textbox', { name: label }).fill(value)
  }
}

async function clickButton(tab, name, options = {}) {
  const btn = tab.playwright.getByRole('button', { name })
  const count = await btn.count()
  if (count === 0) throw new Error(`button "${name}" not found`)
  // Some controls exist twice by design (page header + empty state); callers
  // opt in explicitly instead of silently accepting ambiguity everywhere.
  if (count > 1 && !options.allowMultiple) throw new Error(`button "${name}" count=${count}`)
  await btn.first().click()
}

async function clickLink(tab, name) {
  const links = tab.playwright.getByRole('link', { name })
  const count = await links.count()
  if (count === 0) throw new Error(`link "${name}" not found`)
  await links.first().click()
}

export async function runAllTests(tab) {
  const results = []

  // 1. Login flow.
  try {
    await tab.goto(`${BASE}/login`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    await fillForm(tab, FREE_USER)
    await clickButton(tab, 'Log in')
    await tab.playwright.waitForTimeout(3000)
    const url = await tab.url()
    verdict(results, '1. login redirects to /dashboard', url.includes('/dashboard'), `url=${url}`)
  } catch (error) {
    verdict(results, '1. login redirects to /dashboard', false, String(error))
  }

  // 2. Dashboard layout.
  try {
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '2. dashboard renders sidebar + overview',
      s.includes('Welcome back') && s.includes('Overview') && s.includes('Settings'),
    )
  } catch (error) {
    verdict(results, '2. dashboard renders sidebar + overview', false, String(error))
  }

  // 3a. Projects page renders.
  try {
    await clickLink(tab, 'Projects')
    await tab.playwright.waitForTimeout(2000)
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '3a. projects page renders',
      s.includes('New project') || s.includes('No projects yet'),
    )
  } catch (error) {
    verdict(results, '3a. projects page renders', false, String(error))
  }

  // 3b. Create project via dialog.
  const createdName = `Flow Project ${Date.now()}`
  try {
    await clickButton(tab, 'New project', { allowMultiple: true })
    await tab.playwright.waitForTimeout(800)
    await tab.playwright.locator('#project-name').fill(createdName)
    await tab.playwright.locator('#project-description').fill('Created by the e2e flow')
    await clickButton(tab, 'Create project')
    await tab.playwright.waitForTimeout(2500)
    const s = await tab.playwright.domSnapshot()
    const created = s.includes(createdName)
    if (!created) {
      // Close the dialog so a quota rejection cannot block the remaining steps.
      await tab.playwright.keyboard.press('Escape')
      await tab.playwright.waitForTimeout(800)
    }
    verdict(results, '3b. create project via dialog', created, createdName)
  } catch (error) {
    verdict(results, '3b. create project via dialog', false, String(error))
  }

  // 4. Project detail view.
  try {
    await clickLink(tab, createdName)
    await tab.playwright.waitForTimeout(2000)
    const url = await tab.url()
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '4. project detail view',
      /\/dashboard\/projects\/.+/.test(url) && s.includes(createdName),
      `url=${url}`,
    )
  } catch (error) {
    verdict(results, '4. project detail view', false, String(error))
  }

  // 4b. Clean up: the free plan allows 3 projects, so the flow deletes what it
  // created — otherwise repeated runs hit the quota (402) and later steps fail.
  try {
    const cleaned = await tab.playwright.evaluate(async () => {
      const res = await fetch('/api/projects?limit=100&offset=0', { credentials: 'include' })
      const page = await res.json()
      const mine = page.items.filter((p) => p.name.startsWith('Flow Project '))
      for (const project of mine) {
        await fetch(`/api/projects/${project.id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        })
      }
      return mine.length
    })
    verdict(results, '4b. flow cleans up its own projects', true, `deleted=${cleaned}`)
  } catch (error) {
    verdict(results, '4b. flow cleans up its own projects', false, String(error))
  }

  // 5. Settings — account.
  try {
    await clickLink(tab, 'Settings')
    await tab.playwright.waitForTimeout(2000)
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '5. settings shows account info',
      s.includes('Account') && s.includes(FREE_USER.email),
    )
  } catch (error) {
    verdict(results, '5. settings shows account info', false, String(error))
  }

  // 6a. Billing page renders plans.
  try {
    await clickLink(tab, 'Billing')
    await tab.playwright.waitForTimeout(2000)
    const s = await tab.playwright.domSnapshot()
    verdict(results, '6a. billing page renders plans', s.includes('Pro') && s.includes('Free'))
  } catch (error) {
    verdict(results, '6a. billing page renders plans', false, String(error))
  }

  // 6b. Upgrade button error path (no billing provider locally).
  try {
    await clickButton(tab, 'Upgrade to Pro')
    await tab.playwright.waitForTimeout(2500)
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '6b. upgrade button shows error toast (no provider)',
      s.includes('unavailable') || s.includes('not configured'),
    )
  } catch (error) {
    verdict(results, '6b. upgrade button shows error toast (no provider)', false, String(error))
  }

  // 7. Log out button.
  try {
    await clickLink(tab, 'Overview')
    await tab.playwright.waitForTimeout(1500)
    await clickButton(tab, 'Log out')
    await tab.playwright.waitForTimeout(2500)
    const url = await tab.url()
    verdict(results, '7. log out button signs out', url.includes('/login'), `url=${url}`)
  } catch (error) {
    verdict(results, '7. log out button signs out', false, String(error))
  }

  // 8. Auth gate after logout.
  try {
    await tab.goto(`${BASE}/dashboard`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(2000)
    const url = await tab.url()
    verdict(
      results,
      '8. auth gate bounces signed-out /dashboard to /login',
      url.includes('/login'),
      `url=${url}`,
    )
  } catch (error) {
    verdict(results, '8. auth gate bounces signed-out /dashboard to /login', false, String(error))
  }

  // 9. Signup flow.
  try {
    await tab.goto(`${BASE}/signup`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    const email = `e2e-${Date.now()}@example.com`
    await fillForm(tab, { Name: 'E2E Runner', Email: email, Password: 'password123' })
    await clickButton(tab, 'Sign up')
    await tab.playwright.waitForTimeout(3500)
    const url = await tab.url()
    verdict(
      results,
      '9. signup creates account and redirects',
      url.includes('/dashboard'),
      `url=${url}`,
    )
  } catch (error) {
    verdict(results, '9. signup creates account and redirects', false, String(error))
  }

  // 10. New accounts see the unverified badge and can request another email.
  try {
    await tab.goto(`${BASE}/dashboard/settings`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(2500)
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '10. settings shows Unverified + resend control',
      s.includes('Unverified') && s.includes('Resend verification email'),
    )
  } catch (error) {
    verdict(results, '10. settings shows Unverified + resend control', false, String(error))
  }

  // 11. Forgot-password page accepts an email and reports the neutral result.
  try {
    await tab.goto(`${BASE}/forgot-password`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    await tab.playwright.getByRole('textbox', { name: 'Email' }).fill('sari@example.com')
    await clickButton(tab, 'Send reset link')
    await tab.playwright.waitForTimeout(3000)
    const s = await tab.playwright.domSnapshot()
    verdict(
      results,
      '11. forgot-password submits and confirms',
      s.includes('reset link is on its way'),
    )
  } catch (error) {
    verdict(results, '11. forgot-password submits and confirms', false, String(error))
  }

  // 12. Reset page guards a missing token and validates mismatched passwords.
  try {
    await tab.goto(`${BASE}/reset-password`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    const guard = await tab.playwright.domSnapshot()
    verdict(results, '12a. reset page needs a token', guard.includes('Reset link needed'))

    await tab.goto(`${BASE}/reset-password?token=e2e-invalid-token`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    await tab.playwright.getByRole('textbox', { name: 'New password' }).fill('password123')
    await tab.playwright.getByRole('textbox', { name: 'Confirm password' }).fill('password124')
    await clickButton(tab, 'Update password')
    await tab.playwright.waitForTimeout(1500)
    const mismatch = await tab.playwright.domSnapshot()
    verdict(
      results,
      '12b. reset page rejects mismatched passwords',
      mismatch.includes('Passwords do not match'),
    )
  } catch (error) {
    verdict(results, '12ab. reset page guard and validation', false, String(error))
  }

  // 13. Verification landing page renders each outcome.
  try {
    await tab.goto(`${BASE}/verify-email?status=verified`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    const ok = await tab.playwright.domSnapshot()
    await tab.goto(`${BASE}/verify-email?status=invalid`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(1500)
    const bad = await tab.playwright.domSnapshot()
    verdict(
      results,
      '13. verify-email page renders verified and expired states',
      ok.includes('Email verified') && bad.includes('Link expired'),
    )
  } catch (error) {
    verdict(
      results,
      '13. verify-email page renders verified and expired states',
      false,
      String(error),
    )
  }

  // 14. Files page: upload through the UI input, then delete the row.
  try {
    await tab.goto(`${BASE}/dashboard/files`)
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded' })
    await tab.playwright.waitForTimeout(2000)
    const empty = await tab.playwright.domSnapshot()
    verdict(results, '14a. files page renders with usage + empty state', /of .* used/.test(empty))

    // The automated browser cannot open a native file chooser, so the File is
    // injected into the input and a change event fired — the same code path.
    await tab.playwright.evaluate(() => {
      const input = document.getElementById('file-upload')
      const dt = new DataTransfer()
      dt.items.add(
        new File([new TextEncoder().encode('e2e upload')], 'e2e-file.txt', { type: 'text/plain' }),
      )
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await tab.playwright.waitForTimeout(3500)
    const uploaded = await tab.playwright.domSnapshot()
    verdict(results, '14b. file uploads through the page', uploaded.includes('e2e-file.txt'))

    await tab.playwright.getByRole('button', { name: 'Delete' }).first().click()
    await tab.playwright.waitForTimeout(3000)
    const state = await tab.playwright.evaluate(async () => {
      const res = await fetch('/api/files', { credentials: 'include' })
      return res.json()
    })
    verdict(
      results,
      '14c. delete removes the file server-side',
      state.items.length === 0 && state.usedBytes === 0,
    )
  } catch (error) {
    verdict(results, '14. files upload/delete flow', false, String(error))
  }

  return results
}

/** Prints a results array in a human-readable form. */
export function summarize(results) {
  const failed = results.filter((r) => !r.pass)
  const lines = results.map(
    (r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`,
  )
  lines.push(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`)
  return lines.join('\n')
}
