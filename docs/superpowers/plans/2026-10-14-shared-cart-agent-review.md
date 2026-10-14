# Shared cart continuation review — 2026-10-14

Reviewed working tree: `codex/shared-server-cart`, based on
`33a9a265c4f5639b25ec873005e05ccef4eaa577`. This is a review of the
uncommitted continuation and its integration with the earlier implementation.
It is not a release approval. Existing unrelated work is preserved.

## Validated findings and fixes

| Area | Finding | Correction and regression coverage |
| --- | --- | --- |
| Native account adoption | Linking rotates the principal, but ordinary mutation reconciliation rejected that legitimate rotation. Recovery was not connected to the coordinator. | Separate owner-bound account reconciliation; recover the exact original operation and cart; persist verified promotion before acknowledgement. Coordinator and account checkout tests. |
| Native account privacy | Persisted account cart grants could be read after changing shoppers; ordinary renewal lost owner metadata. A captured shopper could receive another shopper's JWT during an auth transition. | Persist and atomically read the owner with the proof, reject owner mismatches before transport, and verify the authenticated session subject before returning a JWT. Owned-session, storage and shopper-token tests. |
| Account retry | UI retries could reuse an operation key with a different choice/body. Late account responses could publish into a different shopper/merchant scope. | Freeze the original request, expose explicit retry, fence late outcomes by owner/scope, and re-adopt a selected saved cart independently of its version. Web hook/component and native panel tests. |
| Native checkout | Repeated snapshot objects prepared repeatedly; old preparation responses could restore a stale review after cart edits or logout. | Bind preparation and publication to tenant, owner, cart, version and retry generation. Preserve operation identity only for an uncertain retry. Deferred-response hook tests. |
| Native checkout totals | Submission/display could use cached prices and quantities rather than the server review, or silently omit unavailable lines. | Build from the reviewed remaining identities, quantity and effective price; discard invalid negotiations; block unavailable lines until reviewed. Pricing, submit and builder tests. |
| Web logout | Revocation or logout HTTP failure was treated as successful teardown. | Keep authentication/local state on failure, require acknowledged grant revocation and logout, and show a safe retry notice. Mocked logout tests. |
| UCP ownership | Omitting caller identity bypassed an existing recorded caller's check. | Require a matching caller whenever a record has an owner. Adapter tests. |
| Checkout lifetime | A near-expiry cart could expire before the new 30-minute checkout session. The large-total SQL assertion also accepted a missing result. | Append-only prepare function correction extends cart lifetime to the accepted session; SQL asserts success and NULL-safe totals. Near-expiry regression failed before the correction and passed afterward. |
| UCP concurrency | A timestamp CAS could reuse its prior value within one clock tick. | Append-only database trigger guarantees an advancing revision for every writer. Disposable SQL regression reproduces the lost update without the guard and passes with it. |
| Web legacy import | The queue incorrectly settled an in-flight create as a failed import. Retrying could change its lines/body; empty retries could stick pending forever. | Keep create settlement in provisioning, retain its exact request, and resolve empty retries as skipped. Deferred create/retry tests. |
| Native rendering | Cart enablement was read without subscribing. | Subscribe to enablement and verify UI changes even when status is unchanged. |
| Browser proof | The authored concurrency spec mutated before the other tab adopted and missed query-bearing routes; one context lacked the network guard. | Adopt old version first, mutate from an independently guarded context, force stale-review refresh, and assert the removed line disappears and no order request occurs. Chromium/WebKit mock harness. |
| Test infrastructure | Global Expo Crypto mock silently treated unknown algorithms as SHA-256. | Reject unsupported algorithms, with a regression test. |

## Verification

All database exercises use an owned disposable PostgreSQL cluster with synthetic
roles/claims. Browser checks use a localhost fixture stack and deny unexpected
network traffic. No production credentials, customer carts, orders or deployments
are involved. The disposable database was stopped after verification.

- Shared package full suite: **231 files, 1,612 tests passed**.
- Browser stale multi-context checkout: **Chromium and WebKit passed**; the
  remaining cart replaces the old review and order request count remains zero.
- SQL: account continuity, mutation permissions, customer links, realtime,
  checkout binding, caller-scoped idempotency and advancing revision checks passed.
- Native broad suite: **1,465 suites / 8,665 tests passed**, with one additional
  suite failing to load after a Jest worker SIGSEGV. That suite passed in an
  isolated rerun (three rechecked suites / eight tests passed). A previous
  serial full attempt also terminated with SIGSEGV, so the broad run is not
  reported as a single green execution.
- Final focused native run: **28 suites / 150 tests passed**, including the
  owner-switch regression added after the broad run.
- Final focused web run: **87 files / 540 tests passed**.
- Credential-path integration checks after fixing the missing expected cart
  paths: **two files / two tests passed**.
- Monorepo lint/typecheck: **10/10 Turbo tasks passed**. Existing warnings
  remain; the deliberate owner-reset dependency is documented.
- Final pending-source hash check: **17 pending sources, one test passed**.
- Broad web execution is **not green**. It was stopped after confirmed clean-tree
  and frozen-source authority failures; final totals are unavailable. Isolated
  rechecks establish that the Cloudflare preparation requires a clean tooling
  worktree and both storefront inventory checks reject source content that
  differs from the approved commit. These gates were preserved. A Piggyvest
  timeout from the broad run passed when isolated. The earlier UCP/import
  failures were rerun against the corrected code in the final focused run.
- `git diff --check` passed at the review checkpoint.

Local test evidence is under `/tmp/cart-agent-review-*`; these are ephemeral
local logs, not production evidence.

## External review disposition

CodeRabbit's root scan rejected 164 files against its 150-file limit. Separate
web and native scans completed (three web findings and five native findings).
A SQL scan completed with two additional findings, both validated and corrected.
Valid behavior findings and applicable minor fixes were addressed. Its reviewed
file lists do not prove exhaustive coverage of all untracked additions; those
were inspected locally and exercised through the focused suites.

- Web import race and empty retry findings: validated and fixed; regression tests
  reproduced the failure before correction.
- Native enablement subscription, bound UUID fixture, type-only import and
  checkout store selector: corrected.
- SQL checkout lifetime and NULL-safe test assertion: corrected with the local
  RED/GREEN regression and an append-only migration; earlier migrations remain
  unchanged.
- Request to log raw native teardown errors: rejected. The static failure message
  deliberately avoids retaining credential/provider details. Failure remains
  observable and retryable without logging an unconstrained exception object.
- Duplicated parser constants: nonblocking maintenance suggestion. Current sets
  match; no parser behavior defect was demonstrated. A broader consolidation is
  deferred to avoid unrelated churn in this review.

## Remaining implementation/release boundaries

This continuation is not the complete production rollout. Canonical UCP platform
principal delegation, external profile qualification, real-device behavior,
production metrics and two-device realtime convergence remain distinct gates.
The pending migrations have not been applied remotely. Frozen-source authority
and inventory checks must be evaluated against the eventual committed candidate;
this review does not rewrite their provenance to accept a dirty tree.

No commit, push, merge, deployment, payment or real order was performed.


## PR preparation follow-up

Owner authorized committing the shared-cart work and opening a PR. Fresh source
checks found additional colocated-test gaps in account settings, merge-conflict
choices and account schemas, plus two runtime modules above the enforced size
limit. Added behavioral coverage and extracted reservation-expiry logic and UCP
constants. No authority gate was relaxed.

Fresh scoped CodeRabbit scans include previously untracked cart modules. The
validated follow-up fixes prevent false retry errors while provisioning,
clear resolved import conflicts, retain healthy realtime channels on brief
background transitions, and bound malformed handoff RPC failure codes. Shared
checkout parsing now reuses the repository envelope guards/error set and keeps
its internal line parsers private. Local tests reproduced the behavior defects
before the corrections. Account merge/foreign-merchant and receipt/snapshot
mismatch cases also have direct coverage.


The fresh mobile scan completed with six findings. Corrections add an explicit
failed-review retry control and a submit explanation, avoid reporting loading
for background refresh of a confirmed cart, version the merchant projection
cache key, distinguish definitive account-choice rejection from uncertain retry,
and narrow condition values without a cast. Successful explicit legacy/pairing
choices clear conflict UI. Ordinary refresh intentionally does not clear an
unresolved choice. Regression tests cover these behaviors; mocked submits do
not call a real order service.
