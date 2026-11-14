# Independent S-02 review — 6 October 2026

Scope: current uncommitted Oxygen work in `/Users/mac/Baci-worktrees/oxygen-integration`.
The previous implementation-agent report is historical evidence; this review reran its
baseline and examined the actual transport/cache and tests.

## Findings reproduced and fixed

- **Expired completed flight retained after mutable key change.** `getToken` retained
  the caller's key object across an asynchronous login and passed it directly to the
  adapter. Mutating either object changed the identity used to store/clear the flight.
  Later calls to the original key returned its completed flight indefinitely, including
  after token expiry. Two regressions demonstrate the expired-token result. The cache
  now snapshots account/environment before awaiting and gives the adapter a separate
  copy. Stable flight cleanup and expiry-based renewal follow the original identity.
- **First caller received an already-expired login token.** Request-start anchoring
  prevents latency from extending validity but did not reject a response whose lifetime
  was fully consumed in transit. Two boundary regressions cover delivery at and after a
  one-second lifetime. Transport now checks completion time against the conservative
  expiry and returns its safe `invalid_response` error. No automatic retry was added.

These defects existed behind the original 158 passing tests and clean review report.
They have no demonstrated production impact: these modules remain unwired.

## Verification

Command: `pnpm --filter @baci/web exec vitest run src/lib/payments/oxygen/ src/schemas/oxygen-login.test.ts`.

- Baseline: 158/158 passed, five files.
- Behavioral RED before runtime edits: 162 tests executed, four assertion failures,
  158 passed. No setup/import failure was counted.
- GREEN after the initial two fixes: 162/162 passed, five files.
- `pnpm turbo lint typecheck --filter=@baci/web`: two tasks passed.
- `git diff --check`: passed.
- Fresh CodeRabbit review completed on 21 files with one minor timeout-configuration
  finding. Six regression cases failed before the fix (53 passed in that transport
  run). Invalid/non-positive/fractional/overflow delays now fail before provider invocation.
  Final suite: 168/168 passed; web lint/typecheck rerun after this change.
  No second clean CodeRabbit verdict is claimed after this minor fix.

Validation is the affected-web scope from the current primary checkout's validation
instructions. No shared runtime, dependencies, migration or cross-app behavior changed.
Removed an implementation-only assertion that the injected clock is called exactly once;
expiry values remain behaviorally asserted and completion now needs a second clock read.

The previous S-02 residual labeling timeout configuration as info-only is superseded
by this implemented guard. Local Markdown links were checked and passed.

## Next slice: availability design

Repository inspection found no Oxygen registration or enable field in:

- `packages/shared/src/contracts/payment-method-settings.ts`
- `apps/web/src/schemas/merchant-features.ts`
- `apps/web/src/app/dashboard/settings/payments/payment-settings.ts`
- `apps/web/src/config/agentic-payment-methods.ts`

The BNPL launcher currently supports other providers. Source search found no Oxygen
references in application routes/components. The Credit Direct sign route is an existing
example of a server-side merchant-enable check; its provider/RPC contract must not be
copied to Oxygen.

The next agent should first define a minimal server-owned availability contract:

1. Resolve the trusted merchant/customer identity outside the policy; never use a
   caller-selected merchant or client-supplied readiness flags.
2. Local availability means permission to start an application, not credit approval.
   Missing configuration, disabled rollout or unverified provider readiness must deny
   initiation. Disabling new applications must not prevent recovery of existing liability.
3. Keep policy/test work app-local initially (`availability.ts` and colocated tests).
   Do not add an `oxygen_enabled` DB column, shared provider ID or visible toggle until
   the actual persistence/account mapping and launch semantics are designed.
4. Define both the future server initiation consumer and method-list consumer before
   claiming a guard is enforced. An unwired helper alone cannot enforce checkout policy.
5. Test observable denial/no provider invocation, identity/environment mismatches, and
   new-initiation disablement versus recovery continuity at the implemented boundary.
   Do not fabricate future contracts to test a made-up enabled happy path.

Provider answers remain unchanged; this review made no provider calls. Integration,
chat checkout, settlement and dispatch acceptance remain outstanding. No commit, merge,
deployment, production setting change or partner message was performed.
