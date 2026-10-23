# Merchant onboarding email implementation plan

Goal: replace account-wide welcomes with a durable merchant-only setup journey.
Architecture: an append-only migration enrolls future merchant inserts in a deduplicated queue. An internal VPS worker checks fresh merchant/readiness facts before each audited ZeptoMail send. Account confirmation no longer sends store instructions. Provider inventory verification and explicit control enablement gate all sends; no existing merchants are backfilled.
Spec: output/audits/baci-onboarding-engagement-2026-10-23.md in the original audit checkout.

- [x] Regression tests: legacy sender cannot send; web workflow cannot launch its old sender; eligibility, readiness changes, unsubscribed/deleted/changed-owner accounts and ambiguous transport outcomes.
- [x] SQL: gated queue, merchant-only enrollment, owner opt-out and service-only claims/context; no automatic retry after dispatch begins.
- [x] Policy/template: transactional setup help at welcome/day1/day3/day5/day7, canonical readiness, escaped HTML, plain text and required monitored Reply-To.
- [x] Worker: recheck identity, control and preference immediately before dispatch; durable dispatch claim, acceptance IDs and reconciliation state; bounded batches.
- [x] Retire legacy Edge Function and web direct welcome; add VPS entrypoint/schedule and operator runbook.
- [x] Run meaningful tests, SQL fixture checks, relevant lint/typechecks, and CodeRabbit before submission. Document provider verification blocker separately from local implementation.

Calls made for this implementation: no marketing/win-back emails through ZeptoMail; first-sale promotion awaits Campaigns inventory/consent verification. No production activation or historical backfill. Operational setup reminders cease when the store is published. Failure before dispatch can retry; uncertain or interrupted dispatch requires reconciliation.

Follow-up scope: add one owner-only live dashboard reminder from canonical readiness,
respect notification preferences, persist a 24-hour cross-device snooze under RLS,
and suppress published/unprovisioned stores. Cover owner isolation, stale requests,
navigation/focus refresh, persistence failures, and snooze/refresh races.

The prior publication typecheck blocker was resolved by installing the already
declared standalone builder-auth dependencies using its frozen lockfile. No
dependency manifest change was needed. Provider inventory/activation remains
blocked by Campaigns invalid_client and missing ZeptoMail read scopes. No production
change has been made; release checks are being refreshed for the combined change.
