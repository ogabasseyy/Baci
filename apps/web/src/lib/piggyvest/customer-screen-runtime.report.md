# Customer screen runtime — READY FOR PARENT REVIEW

## Callable API

`createPiggyvestCustomerScreenRuntime(options)` from `customer-screen-runtime.ts` returns:

- `GET(request: NextRequest): Promise<Response>`: existing strict draft-policy GET response, not a screen response.
- `POST(request: NextRequest): Promise<Response>`: existing strict draft-policy acceptance response. Successful persistence returns `consent: 'accepted'`, never activation or financial eligibility.
- `readScreen(request: NextRequest): Promise<SavingsScreenSource>`: GET request with exactly `?goalId=<bound goal>`; strict serializable DTO for the actual SavingsScreen / WalletContentSection boundary.

Options: `supabase: SupabaseClient`, `goalId: string`, `configuration: unknown`, `termsDocument: unknown`, `execute: Parameters<typeof createPiggyvestCustomerPolicyHandler>[0]['execute']`, and `checkCsrfProtection: Parameters<typeof createPiggyvestCustomerPolicyHandler>[0]['checkCsrfProtection']`.

Construct with a request-scoped authenticated RLS client and server-owned bound goal/configuration/terms. Do not cache authenticated clients globally or accept these options from browser input. The SQL executor and CSRF checker are server-only infrastructure dependencies of the existing handler; no arbitrary actor/goal-resolution callback exists. This batch uses synthetic adapters only and constructs no real database client.

Configuration is the existing strict customer-policy context contract: staging environment, local_test transport, integrationId, expectedBusinessId, merchantId, merchant/customer allowlists, matching expectedProjectId/actualProjectId. No ambient environment lookup or provider configuration is introduced.

## Boundaries

- `getUser()` is the first protected operation, before method validation, CSRF, body parsing, configuration validation or RLS reads. Duplicate authentication is intentional.
- Existing handler owns bounded body/UTF-8 validation, CSRF enforcement, exact revision/terms checks, and policy store persistence.
- Concrete RLS context revalidates authenticated actor and tenant/customer/goal ownership before each store call; executor parameters must match the entire resolved scope and bound goal. Acceptance actor must match initial authentication.
- Successful handler results undergo another concrete RLS context check before release. Post-write failure does not imply rollback: consent may have persisted; reconcile using GET rather than assuming failure means no write.
- Fresh cryptographically random UUID sessionKey per successful screen read; it contains no actor ID, credential or token and conservatively invalidates UI state on reload. It is presentation identity only, not authorization.
- Only the strict public policy/screen schemas project to UI. Failed auth becomes unauthenticated; other failed screen reads become a clean unavailable DTO. Handler errors remain generic/no-store.
- Eligibility, funding and progress are always unavailable, even after accepted consent. No status/funding/provider reader or new lifecycle implementation is connected while active policy resolution lacks verified readiness. No invented monetary units, rates or financial operations.

## Files and verification

Only new files: `customer-screen-runtime.ts` (116 runtime lines), `customer-screen-runtime.test.ts`, and this report. No existing screens, schemas, shared modules or routes changed.

From `apps/web`:

```sh
pnpm exec vitest run src/lib/piggyvest/customer-screen-runtime.test.ts src/lib/piggyvest/customer-policy-handler.test.ts src/lib/piggyvest/customer-policy-context.test.ts
pnpm exec biome check src/lib/piggyvest/customer-screen-runtime.ts src/lib/piggyvest/customer-screen-runtime.test.ts
```

Results: 81 tests passed in 3 files, including 13 binder tests; Biome passed both owned code files. TDD: initial new-module test failed before implementation; exact ownership-change-between-read-and-accept regression subsequently failed against initial implementation and passed after adding concrete scope revalidation.

Synthetic coverage includes auth-before-CSRF/body, cross-user/tenant/goal rows, different otherwise-owned goal, identity change, logout before projection, ownership loss before acceptance, consent persistence independently from funding eligibility, unsupported transport, stale terms, bounded input, invalid store output and sanitized errors.

Limitations: no deployed route, production binding, authenticated provider/remote DB calls, or financial activation. Scoped tests are not a real SQL/RLS integration proof; store transactional checks remain essential to close database races. Parent owns real-client-to-binder-to-SavingsScreen local integration, root checks/typecheck and eventual explicitly verified lifecycle connection.
