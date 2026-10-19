# PR CodeRabbit review dispositions

This is a draft-review record, not a clean-review or release approval. Local committed-diff CodeRabbit review completed for web, mobile and SQL separately because the full patch exceeds the single-review file limit. Web returned 24 findings, mobile 8, and SQL 27. These 59 suggestions are not 59 verified defects. SQL findings are evaluated against the complete append-only migration chain, not isolated intermediate definitions. Logs: `/private/tmp/redvault-pr-coderabbit-web.log`, `/private/tmp/redvault-pr-coderabbit-mobile.log`, `/private/tmp/redvault-pr-coderabbit-sql.log`.

## Corrected and verified

- Catalog condition no longer comes from the client; quote conversion explicitly rejects unsafe integer kobo values.
- Single-refund receipts reject multiple rows, including reconciliation claims. Expanded claim, finish and reconciliation success/error/empty/malformed coverage.
- Guest CSRF retrieval now has a bounded abort timeout before payment verification; the regression proves abort prevents the verification request.
- Webhook tests cover held and evidence-review outcomes for fresh and completed/redelivered transactions, with no paid-completion or settlement calls.
- Native fixture schema usage now matches the intended roles without relaxing table/function ACLs. Tiered SQL checks use strict row selection and null-safe comparisons.

Parent verification: web review-fix slice 130 tests passed; mobile service slice 4 tests passed; aggregate lint/typecheck passed. Ordered native migration smoke 900–923 passed after fixture hardening. Logs: `/private/tmp/redvault-pr-review-fixes-web.log`, `/private/tmp/redvault-pr-review-fixes-mobile.log`, `/private/tmp/redvault-pr-lint.log`, `/private/tmp/redvault-pr-types.log`. Independent Terra review accepted these corrections.

## Rejected or superseded suggestions

- Do not reclaim an ambiguous initializing attempt and resend provider initialization merely because a lease expires. Reconcile its existing provider reference first.
- Do not move the REDVAULT guard behind unsupported store-credit/prize success paths. Those combinations deliberately fail closed.
- Explicit mobile status retry already clears the completion latch; repeated unsolicited completion callbacks remain guarded.
- Migration 920's old-only membership weakness is superseded by 921. Existing storefront order creation allows only unpaid/pending statuses, and the protected REDVAULT draft forces unpaid; the reported paid INSERT path is not exposed by that call graph.
- The old `redvault-payment-flow.ts` model has no production importer; actual initialization uses the durable claim-first adapter. Findings about that model are not proof of duplicate initialization in the active path.

## Outstanding follow-ups and gates

- Migration 907 updates `requested` refunds before replacing the old state constraint. Fresh empty-install replay passes, but a partially applied installation with existing requested rows can fail. Before deployment, check for such a state and require a reviewed remediation decision; do not edit frozen migrations or claim the fresh replay proves this upgrade case.
- Generated RPC typing, the unused flow model, module separation, narrower provider-URL defense, error classification, additional fixture assertions, and portable local PostgreSQL executable discovery remain explicit review follow-ups. No all-findings-resolved claim is made.
- The full-suite run started before review fixes finished and therefore is not immutable final-head evidence: it reported two quote regression failures against the earlier loaded implementation. The corrected focused rerun passes; CI/final-head full validation remains required. Prior complete green results remain tied to their documented earlier SHA.
- Keep the PR draft and REDVAULT disabled until review/CI and remaining provider/commercial/release decisions are settled. No production migration, deployment, real payment or email occurred.
