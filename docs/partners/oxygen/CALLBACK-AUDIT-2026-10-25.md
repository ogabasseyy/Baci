# Oxygen payment callback audit — 25 October 2026

## Verified contract

Oxygen documents one registered callback URL per partner. Transaction callbacks include `loan_request_reference`, which identifies the booked plan. Authenticate and durably retain the event, then query the split-payment/setup confirmation endpoint for that exact booked reference. Callback monetary fields and browser redirects are not payment confirmation. Require both `split_payment.completed` and `repayment_setup.completed` before displaying payment confirmed.

Source: https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis#webhooks

## Current implementation and evidence

The local POST receiver is `/api/payments/oxygen/webhook`. It authenticates before accepting events, durably deduplicates them, and schedules reconciliation. This is source inspection, not proof that production has the receiver deployed or registered. The current runtime deliberately rejects production and uses staging configuration.

A scoped read of the isolated staging callback inbox found zero transaction callbacks for booked reference `438f96ee-37c4-49bb-a56c-51451f9cb624`. This does not establish whether Oxygen delivered to a different registered URL. The registered public URL and Oxygen delivery receipt remain unverified. Localhost cannot receive an external provider callback directly.

The last provider status read, at 06:45:26 Africa/Lagos on 25 October, returned split payment incomplete and repayment setup complete. No provider status request was made during this callback audit.

## Local correction

Blocked workflows previously caused callbacks to be marked complete without a provider read. They now defer through the existing bounded retry policy. A regression test failed against the original behavior and passed with the correction. Four affected test files passed, 44 tests total; web and tools-worker typechecks and changed-file Biome checks passed. Existing staged work was unchanged.

This correction does not bypass the original indeterminate approval hold. At this initial audit point, the booking still needed a worker-scoped, status-only bridge into the separate payment recovery ledger so its callback can refresh payment evidence without rewriting approval history. Deferred events eventually remain retained as observed after the existing retry limit; they are not an unlimited automatic retry guarantee.

## Next verification

Use a public HTTPS staging receiver and verify the partner registered URL and authenticated delivery. Replay a synthetic authenticated callback with mocked provider confirmation, covering duplicate delivery, incomplete status, timeout and completion. Verify customer UI refreshes from confirmed server state. A production payment is unnecessary for this contract test. Production wiring, deployment and registration require separately authorized work.

No booking, OTP, approval, cancellation, activation, settlement, credential or production configuration changes were performed.

## Follow-through implementation

The callback recovery bridge is now implemented in `callback-payment-recovery.ts` and the append-only migration `20261025101311_oxygen_callback_payment_recovery.sql`. Webhook after-processing and the authenticated reconciliation entrypoint dispatch transaction events through it. The database validates enabled staging worker/merchant/partner binding, durable callback ID and retry key, canonical booking, workflow version, order and original command guards. Only a `check_status` recovery command can be created. Response evidence uses the existing encrypted recovery recorder. Duplicate successful commands are reused; failed reads defer the callback through the existing retry policy. The approval hold is retained.

The new functions were installed only in isolated staging after transactional regression tests. Before/after fingerprints of all existing workflows, original commands and provider states matched. No real booking, approval or provider payment-status call was made for this test.

The checkout now watches saved recovery results after opening payment, and performs at most three fallback status checks per watch, in addition to the existing return-triggered read. It skips hidden-tab ticks, serializes requests and cleans up on confirmation/unmount. Twenty scheduled ticks are bounded; slow responses extend elapsed time. Returning users see confirming, delayed or confirmed states in the same modal. Delayed confirmation does not imply failed payment or generate another link. If only payment is confirmed, repayment setup remains available. UI transitions were verified with mocked responses in component tests, not a live provider callback or browser visual recording.

Affected checks: 99 tests across 13 files passed; after the final pending-state/repayment-only changes, all 23 tests across the three affected UI files passed again, including the added partial-completion regression. Both web/tools-worker typechecks passed and 13 changed TypeScript files passed Biome. Broader Oxygen scope: 1068 passed and 3 failed across 97 files. Those three assertions expect older approval UI (`Send approval OTP`, `Pay upfront amount`, `Your application is being checked`) outside this callback change; they were not rewritten here.

Public delivery remains unverified. The official docs expose create/update registration, but no read-registration endpoint was found in the current Support APIs page/index. Do not invent a URL or replace an existing registration blindly. Obtain the stored URL/auth mode and delivery status from Oxygen configuration or delivery logs, then perform an authenticated staging delivery test. Production remains disabled and no callback registration was changed.
