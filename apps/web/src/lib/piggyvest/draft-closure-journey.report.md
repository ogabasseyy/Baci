# Draft closure customer journey

Local-only implementation; not deployed and not provider validated.

## Owned connections

- Shared public `piggyvest-draft-closure` schemas are extracted from the existing server contract. The server owner imports them while retaining private selection/row envelopes server-side.
- Shared `piggyvest-draft-closure-client`, `-controller` and `-client-binding` use the existing bounded customer request transport and authenticated `/close-plan` GET/POST. No public balance/provider-empty assertion or provider identity is added.
- Web `draft-closure-binding.tsx` and native `PiggyvestDraftClosureBinding.tsx` require explicit displayed-review consent, render plain terms, block duplicate submission, and retain uncertainty until matching readback. Same-operation recovery is supported through the caller-owned operation ID and `recovery: true`.
- Mapped/provider-exposed plans display reconciliation required, never closed/refunded. A receipt explicitly states no refund and no provider-wallet deletion. Closed/uncertain states continue to block incompatible actions.
- Screen integration belongs to Descartes (web) and Sartre (native), not these owned files.

## Verification

- Shared schema/client/controller/binding: 16 tests passed.
- Web component: 3 tests passed. Native component: 2 tests passed, including a retained native callback after a refresh and conflicting operation.
- `bash tools/test/draft-closure-local.test.sh`: final exit 0; existing HTTP 4 + new rendered UI/HTTP/PG 2 + database restart 1. Frozen full migration manifest and standard restricted executor; no alternate catalog.
- `/tmp/piggy-closure-ui-final2.log`: synthetic session and rendered screen, actual CSRF bootstrap/cookie, loopback HTTP and PostgreSQL. Lost committed response resolves through GET; exactly one receipt and zero ledger operations for goal816; fresh binding reads closure without a second POST. Mapped goal1 renders reconciliation with GET only.
- One prior enhanced-test run failed because a new test was accidentally nested during editing. Corrected test placement; the final run passes and its temporary clusters are removed.
- Scoped Biome and shared typecheck pass. Earlier shared typecheck encountered a concurrently unfinished device-change module; the final rerun passes. Parent owns broad root validation.
- Three schedule-support repository-gate gaps now have meaningful colocated tests (3 passed): runtime fixture identity/executor, external HTTP/CSRF-cookie rejection, failed-bootstrap cleanup.

## Review / freeze

Hooke found no further standalone closure issue. The web owner fixed recursive sibling guards. A subsequent combined regression exposed temporary sibling busy state permanently invalidating the other controller. Schedule and closure now separate identity/view lifetime guards from transient dispatch compatibility: reads remain valid, incompatible dispatch is rejected, and the initiating operation's acknowledgement/recovery is not poisoned. Shared direct regressions, the real paired web test, and native all-five-controller tests pass. Native owner reports 16 suites/81 tests green; this task independently reran native closure screen/component and schedule component (9 tests green).

Final post-fix actual runs: `/tmp/piggy-schedule-compat-final.log` (13 phase-cases, eight observed lock races) and `/tmp/piggy-closure-compat-final.log` (HTTP4/UI2/restart1), both exit 0. Scoped Biome (30 files) and shared typecheck pass. Pending final independent review acknowledgement; no further owned runtime edits planned.

No SQL changes, grants, provider mutations, Paystack changes, external messages, commits or deployment. Existing migrations remain frozen. Screen owners have integrated the optional bindings with reciprocal gates; this establishes local test evidence only, not live readiness.
