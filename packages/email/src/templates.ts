export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

export interface TemplateContext {
  appName: string
  appUrl: string
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto">
<h2 style="color:#111">${title}</h2>
${bodyHtml}
<p style="color:#888;font-size:12px">Sent by your application. If you did not expect this email, ignore it.</p>
</body></html>`
}

export function verifyEmail(ctx: TemplateContext, url: string): EmailTemplate {
  return {
    subject: `Verify your email — ${ctx.appName}`,
    html: layout(
      'Verify your email',
      `<p>Click to verify:</p><p><a href="${url}">Verify email</a></p>`,
    ),
    text: `Verify your email: ${url}`,
  }
}

export function resetPassword(ctx: TemplateContext, url: string): EmailTemplate {
  return {
    subject: `Reset your password — ${ctx.appName}`,
    html: layout(
      'Reset your password',
      `<p>This link expires soon.</p><p><a href="${url}">Reset password</a></p>`,
    ),
    text: `Reset your password: ${url}`,
  }
}

export function planChanged(
  ctx: TemplateContext,
  opts: { plan: string; status: string },
): EmailTemplate {
  return {
    subject: `Your ${ctx.appName} plan is now ${opts.plan}`,
    html: layout(
      'Plan updated',
      `<p>Your subscription is <strong>${opts.plan}</strong> (${opts.status}). Manage it any time from your billing settings.</p>`,
    ),
    text: `Your ${ctx.appName} plan is now ${opts.plan} (${opts.status}).`,
  }
}

export function receiptPlaceholder(
  ctx: TemplateContext,
  opts: { plan: string; interval: string },
): EmailTemplate {
  return {
    subject: `Your ${ctx.appName} subscription (${opts.plan}/${opts.interval})`,
    html: layout(
      'Subscription receipt',
      `<p>Plan: ${opts.plan} (${opts.interval}). This is a receipt placeholder; wire real invoice data at launch.</p>`,
    ),
    text: `Subscription receipt placeholder for plan ${opts.plan} (${opts.interval}).`,
  }
}

export function welcome(ctx: TemplateContext, name: string): EmailTemplate {
  return {
    subject: `Welcome to ${ctx.appName}`,
    html: layout(
      'Welcome',
      `<p>Hi ${name}, your account is ready. Get started at ${ctx.appUrl}.</p>`,
    ),
    text: `Hi ${name}, your account is ready. Get started: ${ctx.appUrl}`,
  }
}
