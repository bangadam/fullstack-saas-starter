# @saas/sdk

Placeholder package. Per the plan (SAAS-BOILERPLATE-PLAN.md section 5), this
package will hold the OpenAPI-generated typed client for the API Worker. Until
codegen is wired up, it exposes a minimal hand-written `createApiClient` typed
from `@saas/contracts` so consumers can typecheck against the intended surface.

Replace `src/index.ts` with generated output once the OpenAPI pipeline exists.
