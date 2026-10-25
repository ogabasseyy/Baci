# Unlock-order evidence blockers

Local fixes for Astra's negative-finance and stale-assessment findings. No rollout, prices, paid checks, or production database changes are included.

- The central evaluator recognizes negative finance evidence before positive labels. Only explicit positive labels qualify as clean; unknown/ambiguous phrases cannot qualify a clean-only product. Other explicitly supported segments retain their own product matching.
- Final order context loads persisted eligibility evidence and the selected product's carrier, model scope and status segment. The shared order flow evaluates these again before provider balance reads, wallet redemption, write-ahead or submission; saved eligible/payment_pending/paid status alone is insufficient.
- Invalid unpaid orders receive a safe 409 response. Invalid paid, never-submitted orders use the existing atomic refund path. Paid recovery passes through the same evidence gate.
- Already-started or accepted orders bypass new-order validation and continue through reconciliation. Recovery also reloads current status/attempt markers so an old claim cannot force a submitted order back to paid.
- The append-only migration `20261025183000_petrock_guard_unsubmitted_refunds.sql` locks and checks the current row before an evidence/preflight/recovery refund. It protects provider receipts and submission attempts, including an indeterminate attempt. Definitive provider rejection refunds retain their existing behavior. Existing grants and refund-ledger calls are preserved.

## Validation scope

Regression tests cover parser-to-evaluator negative responses, ambiguous and explicit positives, matching persisted evidence to the selected carrier/model/status, invalid saved order states, real paid-recovery flow, safe API errors, loader projection and refund races. SQL tests use a disposable empty local PostgreSQL database and a stub only at the unchanged wallet-refund boundary; they do not establish production ledger behavior or full migration-history replay.

The old SQL function fails the started-order protection regression. The migration passes guarded-refund, replay/idempotence, unchanged-grant and two-connection submission-versus-refund tests. Fixture and assertions: `supabase/tests/fixtures/petrock_unsubmitted_refund_guard.sql` and `supabase/tests/petrock_unsubmitted_refund_guard.sql`.

This migration has NOT been applied to production. Database protection must accompany the application change before shipping. Astra re-review and final application checks are complete as recorded below. CodeRabbit remains an incomplete gate.

## Final local verification

- Astra independently re-reviewed both blockers and reported no remaining actionable findings; 69 focused tests across six files passed in that review. Astra separately cleared the final paid-recovery result-contract adjustment and its regression test.
- Final affected provider/remediation/API coverage: 294 tests across 46 files passed. The web package typecheck and its tools/MCP/publication typechecks passed. Focused Biome and git whitespace checks passed.
- The SQL protection tests and two-connection race passed in a disposable local PostgreSQL database; the cluster was stopped and removed. The migration remains unapplied to production.
- In the original working checkout, package lint was blocked by unrelated task5-untracked-worker-74451.test.ts/.test.mjs formatting fixtures. They are preserved there and excluded from the clean PR checkout.
- One CodeRabbit attempt was interrupted. A later completed rerun identified one minor catalog-image issue: a bounded 21-row response was discarded before exact matching. That bailout was removed, with regression coverage for the correct colour image and wrong-model/accessory rejection. Astra independently re-reviewed and cleared the correction (13 tests); 25 affected tests and web typechecks passed. Query limits and the shared 1.5-second deadline stayed unchanged. Fresh PR-candidate checks are separate from these historical receipts.

These local verification steps performed no production database changes, live paid checks, price changes or rollout activation. PR publication and CI/review are separate from merge and deployment.
