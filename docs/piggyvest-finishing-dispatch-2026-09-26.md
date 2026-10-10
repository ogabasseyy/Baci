# PiggyVest finishing dispatch

This continues the tested local implementation in `piggyvest-completion-progress-2026-09-26.md`.
It does not authorize production changes, real charges, invented financial policies, or unreviewed deployment.

## Current ownership

| Owner | Model | Work |
| --- | --- | --- |
| Harvey | Terra | Actual staging provider submission/verification adapters and immutable dispatcher requests |
| Aristotle | Terra | Immutable treasury provisioning, conservative refresh/replenishment and SQL tests |
| Pascal | Terra | Durable outgoing identity submission and bounded verify-only reconciliation |
| Pauli | Terra | Purchase/refund execution using explicit reviewed policies, with no fabricated defaults |
| Ptolemy | Luna | Isolated native push configuration/build readiness and remaining client connection |
| Bohr | Terra | Independent review of the integrated canonical funding and exit boundaries |
| Godel | Luna | Separate, statement-restricted submission database executor |
| Parent | Current task | Canonical card projection, shared inflow deduplication, integration and review |

Agents have disjoint file ownership. All existing dirty work remains in place.
No commits, branches, existing migration edits, provider calls, credential changes,
VPS mutations, or lease renewal are part of these delegated tasks.

## Rulings

- A verified card payment is a funding obligation, not savings principal. Principal
  is credited only after correlated PiggyVest terminal success and atomic canonical
  ledger/contribution projection.
- Unknown submission outcomes are verified, never automatically resent.
- Purchase/refund economics are explicit policy inputs. Example policies in tests
  are not owner-approved policies and cannot enable live execution.
- Existing bank and new card receipts must not independently credit the same
  economic operation. Ambiguous receipts for an enabled bridge remain deferred.
- Native device delivery and genuine provider settlement require separate live
  evidence. Mocked tests will not be labelled phone-ready or deployed.

## Execution ledger

- Dispatched five fresh agents: four Terra and one Luna. Parent owns the immediate
  canonical projection dependency rather than waiting on a delegated critical path.
- Added a Terra independent review and a Luna executor lane: seven delegated
  agents total, all Terra/Luna. No user-owned tasks or duplicate checkouts created.
- Parent review rejected the initial provider implementation's live-key acceptance,
  incomplete identity gates, unsafe identifier parsing and unbounded response read.
  Revised implementation rejects live Paystack keys, pins the immutable scope,
  caps streamed response bytes, distinguishes Paystack uint64 IDs from PiggyVest
  opaque IDs, and never treats submission as settlement.
- Parent review rejected the first outgoing-submission implementation's missing
  independent authority and unrecoverable unknown state. The revised writer uses
  independently provisioned authority, a separate restricted PostgreSQL executor,
  and database-derived customer identity during reconciliation. Verify-only
  recovery now handles a crash between provider send and recording the outcome,
  and rejects a pre-existing outbox with a different internal owner.
- Parent review rejected the first exit implementation's JSON-only accounting and
  unverified wallet destinations. Independent destination authority, action-bound
  routes, quote expiry, and original cancellation consent are now enforced. A
  provider adapter merely echoing the request plus success cannot enqueue order
  or refund accounting. Positive exit finality remains deliberately incomplete
  until an independently stored provider-evidence adapter exists.
- Parent integrated PiggyVest replay and transfer tools into the ordinary web
  worker typecheck. Previously they were excluded, hiding actual type errors and
  negative tests that accidentally passed a scalar instead of a parameter array.
  Corrected tests now exercise the full arguments and specific validation failure.

## Parent-verified funding result

The savings checkout now has `prefunded-card-runtime.ts`, a one-step durable
state-machine runner using the actual store/provider adapters. Its private
PostgreSQL rehearsal loads the real canonical ledger, treasury guards and
projection functions together. Provider HTTP is mocked and cannot reach a server.

- Lost collection response becomes unknown, then verification-only: one charge,
  one provider transfer, one canonical savings credit, and no extra credit on retry.
- Eight concurrent projectors yield one applied result and seven duplicates.
- A forced contribution-insert failure rolls back the ledger and projection.
- A known correlated inflow alias is a duplicate; mismatched or unknown aliases
  to explicitly enrolled goals are deferred, not credited a second time.
- Physical database mismatch, wrong worker, missing/reconciled principal, stale
  treasury observations and post-reservation balance drift fail closed.
- The old goal-capacity calculation no longer counts an applied operation twice
  after its amount has already entered `goal.current_amount`.

Fresh parent evidence: 102 prefunded tests across thirteen suites; base storage
SQL, standalone treasury SQL and combined source-runtime/PostgreSQL rehearsal all
pass. The six native build-preflight tests pass. The actual native preflight
correctly reports missing separate native identity/profile/resolved manifest.
The independent Terra review found no additional high/critical defect in the
reviewed prefunded snapshot; this is not a clean review of the entire dirty trees.
Additional parent regressions pin the Paystack charge currency to NGN and serialize
integer kobo as its documented string parameter. Both exact-body regressions were
red before their fixes. The contract references are in the prefunded bundle README.

## Transfer and exit verification

- Receiver replay/transfer/schema tests: 259 pass across 35 suites after integrating
  the single restricted submission executor and correcting full-array test cases.
- The final outgoing SQL harness passes process-crash recovery, same-reference
  ownership conflict, expired/revoked authority, claim races, and restart checks.
  Expiry between the two claim gates rolls back instead of retaining a false claim.
- Exit/runtime/schema tests: 158 pass; three database integration tests are skipped
  in that plain Vitest command. Their dedicated private HTTP/PostgreSQL harness
  separately passes all three, both before and after database restart.
- The real savings-exit SQL harness passes scope, current quote, consent-actor,
  immutable destination authority, failure obligation, rollback and race cases.
  It specifically proves echoed provider success does not create an order/refund
  projection. This does not demonstrate successful purchase or refund completion.
- Independent Terra review accepted the three corrected exit findings. Every
  future canonical consumer must require independent receipt evidence, including
  for pre-hardening fixture/legacy rows; no such consumer currently exists.
- Receiver web typechecking passes with these tools now included. Savings web
  typechecking and focused formatting pass. Whole-workspace checks remain separate.

## Boundaries still open

No new code is deployed. There is no live card charge, provider transfer, new
customer balance, VPS mutation, native build or phone-delivery claim from this run.
The full repository checks are separate from the focused passes: existing mobile
lint/typecheck issues remain. `pnpm turbo test` completed unsuccessfully: the mobile
suite reported 14 failing suites/34 failing tests and 1,220 passing suites/7,164
passing tests; Turbo cancelled the still-running web suite. This is not a clean
whole-repository verification. Logs are in `/private/tmp/baci-finish2-*`.

Before live card activation: restricted provisioning/credentials, an actual saved
authorization resolver, route/scheduler/UI integration, genuine provider evidence,
reversals and positive external-bank-inflow attribution are still needed. The
documented TSQ response alone can lack the identity needed for terminal credit.
Explicitly enrolled card-bridge goals currently defer unlinked inflows; do not
enable that enrollment on ordinary live bank-funding goals as a shortcut.

These are implementation tasks, not merely owner-sudo gates. In particular,
purchase/refund canonical consumers and independently persisted provider evidence
still need connection; native delivery still needs a separate configured build
and actual device proof. Do not describe this pass as seven fully shipped features.

All seven agent assignments are now closed after parent review. No process is
silently continuing a deploy, charge, provider request, or device build.

Purchase/cancellation economics are not silently approved by test fixtures.
Whole-wallet interest allocation and business remainder accounting likewise do
not inherit a per-wallet split from the dashboard's global setting.
