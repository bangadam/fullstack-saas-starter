# Contributing

Thank you for helping improve Fullstack SaaS. Start with the [README](README.md) and [agent operating guide](AGENTS.md).

## Local development

Use Node.js 22+ and the pnpm version pinned in `package.json`. Install dependencies, run `pnpm wizard --yes`, then `pnpm bootstrap` and `pnpm dev` in a fresh checkout. Keep all generated environment files local. Do not replace an existing environment file without reviewing it first.

## Changes

1. Create a focused branch from the repository's default branch.
2. Write or adjust a failing test in the package that owns the behavior.
3. Implement the smallest coherent change.
4. Run `pnpm test`, `pnpm test:scripts`, `pnpm typecheck`, `pnpm lint`, and `pnpm scan:secrets`.
5. For UI routes, verify a full reload and client-side navigation in a real browser. Use only disposable local fixtures for screenshots.
6. Open a pull request explaining the problem, behavior change, verification performed, and any migration or deployment impact.

Keep operator documentation in Bahasa Indonesia. Keep source code and configuration comments in English.

## Architectural constraints

- Preserve `/api/*` paths through the Web Worker proxy; Better Auth lives at `/api/auth`.
- Scope account-owned data reads and writes by `userId`.
- Enforce quotas with conditional writes or atomic batches, not read-then-insert logic. D1 has no interactive transactions.
- Put browser-safe schemas in `packages/contracts`; use `packages/sdk` from web features.
- Add shared UI primitives only through `packages/ui`.
- Verify webhook signatures on the raw body before persistence and processing.
- Keep queued work idempotent and email delivery behind the durable outbox.

The complete rules and module recipe live in [AGENTS.md](AGENTS.md) and [docs/extending.md](docs/extending.md).

## Sensitive information

Never include environment files, API keys, session cookies, real customer exports, local database files, runtime logs, or cloud credentials in a commit, issue, or pull request. Example files must contain placeholders only. The built-in secret scanner is a limited guard, not proof that a file or Git history is safe.

Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md). Do not open a public issue containing exploitation details or credentials.

## Licensing

There is currently no open-source license. Obtain the repository owner's permission before redistributing or sublicensing this code. Contribution review does not change that licensing status.
