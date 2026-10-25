# Security policy

## Reporting a vulnerability

Do not report exploitable vulnerabilities or credentials in a public issue or pull request.

Use GitHub's **Report a vulnerability** option in the Security tab if private reporting is enabled. Otherwise, contact the repository owner privately at **bangadam.dev@gmail.com** with a short description and a request for a secure channel. Do not include live credentials, session cookies, personal data, or full provider payloads in the initial message.

Provide the affected component, steps to reproduce using disposable test data, expected behavior, and observed impact. There is no guaranteed response-time or supported-release policy yet.

## Credentials and local state

- `.env.local`, `.dev.vars`, generated configuration, and cloud credentials stay outside Git.
- Only sanitized placeholder example files belong in the repository.
- Never include `.wrangler`, `.turbo`, local databases, build artifacts, runtime logs, or customer exports.
- Run `pnpm scan:secrets` before committing and review all staged paths. The scanner checks supported patterns in tracked working-tree files; it is not a Git-history or comprehensive secret audit.
- If a real credential was committed, revoke/rotate it immediately and coordinate history cleanup. Deleting the visible value does not revoke it or remove previous copies.

## Deployment responsibilities

Configure separate environment resources and secrets, protected GitHub environments, trusted origins, billing webhook secrets, and the appropriate provider settings before deployment. Never publish local seeded demo accounts. Verify external integrations in a dedicated staging environment.

See [docs/security.md](docs/security.md) for the security architecture and [docs/operations.md](docs/operations.md) for recovery procedures.
