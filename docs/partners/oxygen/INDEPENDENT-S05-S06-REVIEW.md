# Independent S-05/S-06 review — 7 October 2026

Verdict: changes required before interaction-shell wiring. Existing 593 tests pass,
but two independent lifecycle regressions fail. This is a scoped code review, not a
production exploit test or certification of every route/RLS path.

## Findings

### P1: late submit completion invokes handoff after unmount

`use-oxygen-interaction.ts` has no unmount cleanup that invalidates the generation.
Reproduced: mount, resolve availability true, submit, unmount, resolve submit `{ok:true}`.
Actual: the old callback fires with order/nonce and writes a marker. Expected: no
handoff or marker write after the host has left. Invalidate pending completions on
unmount; do not confuse ignoring a response with reversing server effects.

### P1: session-loading transition retains an actionable old submit

The session-loading branch returns without invalidating the generation or removing
ready actions. Reproduced: authenticated ready, submit pending, rerender with session
loading, resolve success. Actual: secure-form callback fires while identity is being
revalidated. Expected: suspend actions and ignore that old handoff until fresh server
revalidation. Also test ready-to-loading and order changes during loading. Account
switches that retain `authenticated` need a stable non-sensitive session identity or
an enforced host event contract; status alone cannot detect them.

### P2: manual memoization violates repository instructions

The new hook imports and uses `useCallback` seven times. Current user-supplied root
instructions forbid adding manual `useCallback`/`useMemo`/`React.memo`. Refactor to
React Compiler-compatible event/effect structure using installed official guidance.
Do not simply remove wrappers and create a rerender/effect loop. Validate composition
and stale-response behavior after the refactor.

### P2: callback failure is treated as completed handoff

The current callback-throw test intentionally observes an unhandled rejection and
expects `handed-off`. A callback that fails to open the secure form can therefore
leave only a Dismiss action with success wording. Define a bounded safe host-error
channel and a truthful retry/recheck state; retain ambiguity rules and never blindly
resubmit a potentially accepted financial request. Suppress raw exception details from
customer copy/logs. This finding is source-grounded; no additional throw test was run
because the existing test already characterizes the failure.

### Future financial integration gate: retry is not reconciliation

`mapOxygenSubmitNetworkFailure` and generic server errors offer `resubmit`; each click
generates a fresh nonce. This is harmless for current Phase A (no writes/provider calls),
but cannot be reused unchanged once attempts mutate provider state. CR-12 must define
stable action/idempotency identity and status recovery before enabling Phase B. A
response-loss retry must not become a second loan. This is a future gate, not a claim
that Phase A currently creates financial duplicates.

## S-05 observations

Routes authenticate before business queries, resolve customer IDs via merchant-scoped
customers rows, use normal Supabase clients, select explicit columns, and return the
same missing/foreign order shape. Current rollout/readiness are disabled; no attempt
writes or provider imports exist. The policy allow mapper remains constant 503.

Ownership proof relies on `getMerchantForApiRequest` returning the requested merchant
and the real DB RLS model. Existing isolated mocks are not evidence of disposable DB
RLS integration. Require those integration checks when persistence or deployment is
in scope. No new confirmed S-05 runtime defect was identified in this scoped pass.

## Executed evidence

Baseline command from worktree root:
`pnpm --filter @baci/web exec vitest run src/lib/payments/oxygen/
src/schemas/oxygen-login.test.ts src/schemas/oxygen-requests.test.ts
src/app/api/payments/oxygen/ src/components/payments/oxygen/`

Result: 14 files, 593/593 passed.

Two temporary regression tests were appended to the existing hook test harness and
run with `-t 'independent lifecycle regression'`. Both executed assertion failures:
expected an empty handoff list; received the prior order/nonce payload. 86 unrelated
hook tests were skipped. The temporary additions were removed after reproduction;
implementation-agent tests remain unchanged. The next agent must add permanent
regressions before fixing runtime code, including marker-write assertions.

No runtime changes, provider calls, customer data, deployment, merge or partner messages.
The previous agent's clean CodeRabbit snapshot is historical; no new CodeRabbit run was
performed for this read-only runtime review. Documentation whitespace checked separately.

## Next agent action

Fix the four current findings with behavioral TDD, then re-review the actual final
snapshot and run affected lint/typecheck/tests. Keep shell unwired, initiation disabled,
and CR-12 reconciliation gate explicit. Partial live login/bank evidence remains valid;
provider contract rows must not all be described as completely unverified.

## Fix follow-up — 7 October 2026

The four current findings above are implemented in the isolated worktree.
Permanent tests were added before runtime edits: four behavioral assertions failed
(loading-ready suspension, callback failure, late success after unmount, late success
while loading), plus the pre-existing unhandled rejection surfaced on the RED run.
GREEN: 595/595 across 14 Oxygen files; affected web lint and typecheck both pass.
Two older loading-state assertions were corrected to the new suspension contract.
The stable sign-in no-op moved to module scope; all manual useCallback was removed.
Effect-triggered synchronization uses React useEffectEvent, called only from an
effect with explicit order/status dependencies. Callback exceptions log only a
fixed diagnostic, preserve the marker and show failed with recheck only. No blind
retry is offered. Hosts must notifySessionEvent when identity changes without a
status change. Design documentation updated; prior evidence is historical.

The shell remains unwired and initiation remains disabled. No live provider calls,
financial writes, credentials, merge or deployment. CR-12 remains a Phase B gate.
Final CodeRabbit: `coderabbit review --agent -t uncommitted` completed with
0 issues across 47 files, including the final hook and regression tests.
This report was untracked and not in its reviewed-file list; its evidence
follow-up is manually checked. No runtime edits followed the review.
