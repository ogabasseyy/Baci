# READY FOR PARENT REVIEW

Worktree: `/Users/mac/Baci-worktrees/cursor-savings-phase1`.

## Exact owned files

- `apps/web/src/lib/piggyvest/customer-funding-view.ts`
- `apps/web/src/lib/piggyvest/customer-funding-view.test.ts`
- `apps/web/src/schemas/piggyvest-customer-funding-view.ts`
- `apps/web/src/schemas/piggyvest-customer-funding-view.test.ts`
- `apps/web/src/lib/piggyvest/customer-funding-view-report.md`

Existing funding adapter, shared schemas, routes and other concurrent files were not edited.

## Stable server API and card contract

`readPiggyvestCustomerFundingView({ configuration, resolveAuthenticatedGoal, execute, fetchImplementation })`

Returns `Promise<PiggyvestCustomerFundingView>`:

```typescript
type FundingView =
  | { status: 'ready'; accounts: Array<{
      accountNumber: string;
      accountName: string;
      bankName: string;
    }> }
  | { status: 'pending' }
  | { status: 'unavailable' };
```

The type is exported from `schemas/piggyvest-customer-funding-view.ts`.
Pending and unavailable have no accounts or metadata. Ready contains 1–32 accounts.
No provider identifiers, paypoint fields, raw error messages or financial values are projected.

Configuration accepts the existing provisioning configuration plus required
`fundingDisplayEnabled: true`. It preserves staging-only origin/environment,
integration and expected merchant, matching expected/actual project IDs,
allowlisted customers, `provisioningApproved: true`, and
`syntheticIdentityApproved: true`. The existing fingerprint key requirement is
inherited but the wrapper does not use it for cryptographic or financial operations.
Blank/noncanonical business identity is rejected. No environment values are read.

`resolveAuthenticatedGoal` is the trusted authentication/authorization boundary,
not a request-body identity parser. For an enabled valid configuration it is called
once and must resolve exactly `{ environment, integrationId, merchantId,
customerId, goalId, providerWalletId, providerCustomerId }`. No auth/malformed
identity returns unavailable. Deployment gates run before storage or HTTP, and
merchant/integration/customer authorization runs before the existing adapter.
The adapter receives only the validated provider configuration and a callback
over the captured identity, preserving its exact goal/customer/wallet mapping
and active wallet/business/currency checks. Only injected fetch is used.

Every invocation reads fresh state. No previous ready view is cached or reused.
Errors return only unavailable and are not logged. Pending means a successful
verified empty funding-account response, not a provider or authorization error.

## Verification

- Test-first run failed because the new implementation modules did not yet exist.
- New projection/schema tests: 2 suites, 41 tests passed.
- Final scoped run including existing funding adapter/schema: 4 suites, 90 tests passed.
- Scoped Biome: all four TypeScript files passed with no fixes required.
- Runtime files are 67 and 39 lines.

Commands, from `apps/web`:

```sh
pnpm exec vitest run src/lib/piggyvest/customer-funding-view.test.ts src/schemas/piggyvest-customer-funding-view.test.ts src/lib/piggyvest/funding-accounts.test.ts src/schemas/piggyvest-funding-accounts.test.ts
```

Biome command, from the worktree root:

```sh
pnpm exec biome check apps/web/src/lib/piggyvest/customer-funding-view.ts apps/web/src/lib/piggyvest/customer-funding-view.test.ts apps/web/src/schemas/piggyvest-customer-funding-view.ts apps/web/src/schemas/piggyvest-customer-funding-view.test.ts
```

Tests exercise the actual funding adapter with synthetic mapping execution and
synthetic injected fetch. Global fetch is prohibited. Tests assert no console
log/warn/error output. Coverage includes deployment disablement, production/foreign
origin, project/integration/merchant/customer mismatch, missing auth, extra identity
and configuration fields, wallet traversal, absent/ambiguous/stale mappings,
provider wallet mismatch, authentication/storage/provider error redaction, exact
three-field projection, pending and clearing prior ready data after auth loss or
malformed responses.

## Limitations and remaining parent work

- Root lint/typecheck/full suite are owned by parent and were not run here.
- Parent must supply the real authenticated resolver and an executor bound to the
  approved isolated project. Equality of supplied project configuration does not
  independently inspect the database or prove deployment isolation.
- No routes, runtime environment wiring, card component integration, deployment,
  authenticated provider calls, remote database calls or customer data were used.
- No monetary units, interest eligibility, withdrawal/refund behavior, ledger
  effects, payment confirmation or spendability are inferred.
- This is a local server funding-display projection, not completion or activation
  of the whole savings integration. Existing readiness-document financial gates remain.
