# Primary wallet release review

This source-only release follows merged PRs #3620 and #3640. It does not
authorize deployment, database changes, provider funding, or payment execution.

## Scope

- PiggyVest ordinary-wallet provisioning, consent, provider-owned accounts and balances.
- Authenticated wallet-to-savings provisioning and pending-operation recovery.
- Signed bank-inflow, card-custody, and paid-interest inboxes with idempotent processing.
- Mobile account setup, payment status, savings handoff, and notifications.
- Preserve legacy Paystack balances and late deposits; use Paystack for card collection.

## Release gates

- Current-main source includes the post-merge reminder and notification fixes in #3640.
- Focused primary server tests: 662 passed; three database suites skipped.
- Full monorepo lint passed before final fixture-only relocation.
- Mobile typecheck reports nine existing Supabase auth test-fixture incompatibilities
  against the borrowed dependency installation. This is not a green typecheck.
- The provider-directory CodeRabbit review refused 208 files against its 150-file
  limit. A complete scoped review remains required; do not treat refusal as approval.
- Mobile review findings were fixed with regression tests. Current-head CI and review
  must still run after publication.
- Deployment, restricted-role readiness, treasury/provider bindings, real signed
  delivery, and physical phone/push checks remain separate unverified gates.

The five October 4 legacy interest-capacity drafts are test fixtures only, not
approved production migrations. They must not change legacy economic policy as
part of this primary-wallet release.
