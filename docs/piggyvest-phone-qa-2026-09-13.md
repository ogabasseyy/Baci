# Physical iPhone savings QA — 13 September 2026

## Environment and limits

Installed Ogabassey development build on the owner's physical iPhone 17 Pro Max.
Local Supabase/Auth and local Next.js services; synthetic customer and catalogue only.
No production data, provider money movement, remote migration, deployment or external message.

## Observed on the phone

- Normal OTP sign-in completed using the local test mailbox.
- Wallet rendered zero balance/savings and no transactions.
- Bank-account creation was visibly unavailable.
- Savings route rendered previously persisted drafts and exact variant labels after sign-in.
- The savings route was opened by its native deep link because the mirroring tool rejects pointer clicks. The Start Savings button itself was not physically exercised by automation.
- Keyboard entry works in Mirroring; pointer clicks currently fail. Manual selection in the Mac Mirroring window is needed to continue the physical journey.

## Fixes and automated evidence

- Local development connectivity no longer requires public-internet reachability when a network connection exists. Production behavior and local-mode validation remain unchanged.
- Isolated local savings mode does not automatically prefetch unavailable external billers. Normal biller behavior remains covered by existing tests.
- Saved drafts now show consent status and creation time rather than only indistinguishable device labels. This UI change passed a failing-before/passing-after regression test; physical rendering of the latest change still needs verification.
- 33 focused connectivity/biller tests passed.
- 269 savings tests passed across 48 suites, including the new draft-list regression.
- 10 focused web wallet tests passed.
- Real local PostgreSQL checks passed for concurrent identical creation, conflicting reuse of a request ID, durable replay/reload, concurrent acceptance, and cross-customer RLS/RPC denial. Financial-table counts remained unchanged. Two synthetic test drafts were retained.

## Not completed

### Search and layout follow-up

The phone reproduced a catalogue search failure. The local relay omitted the
read-only search_products_v2 RPC, and malformed error handling threw while reading
an absent message. Both were fixed with failing-before/passing-after tests. The
phone then displayed Black 256GB at NGN 250,000 and Blue 512GB at NGN 320,000;
the owner selected Blue and its review price matched. No draft was submitted in
that physical selection step.

Cramped variant pills were replaced with full-width multiline options and separate
prices. Draft history now starts collapsed behind an accessible count/toggle,
without deleting records. The full savings tests pass 287 tests in 52 suites;
root lint/typecheck pass. After cold reload, the physical phone displays both
full-width options with all attributes and separate prices. Blue 512GB is selected
at NGN 320,000, the review button is enabled, and eleven saved drafts are collapsed
behind the count/toggle. Selection was restored through the supported native route
parameters; this check does not claim an automated pointer selection or submission.

### Original-design wiring follow-up

Local savings now reuses the existing StartSavingsForm, styled product search,
suggestions and exact-variant controls rather than the former bare draft form.
The local controller still performs real draft create/read/accept requests and
does not mount the legacy payment/active-goal controller. Unsupported schedule,
contribution and funding controls are absent with an explicit local-only notice;
those settings are not silently discarded. Nonlocal and explicit staging routes
retain their existing behavior. The full savings component tests now pass
282 tests across 51 suites. After a cold reload, the physical phone displays the
shared styled heading, product search and saved draft cards while retaining the
authenticated local session. The review action initially lacked its button
background/padding because native CSS interop dropped its callback-based style.
A static style array with explicit press-state feedback fixes this; 11 focused
tests pass, including failing-before/passing-after native interop coverage.
The physical phone now shows the red rounded button with disabled opacity before
device selection. Root lint and typecheck also pass. This does not complete
activation or funding.

This is not a full savings end-to-end pass. Draft acceptance is not activation, a price guarantee, a funding mandate or interest accrual.

The current phone draft screen still ends at saved draft consent. The canonical draft-to-plan connection, selected-duration consent and guarded local database integration require implementation and review. Agent work on a disabled-by-default schema/adapter foundation is not evidence of an applied or connected backend.

Funding, signed financial-event processing, eligible interest, cancellation/refund execution, completion and purchase have not been validated against PiggyVest staging in this run. Provider contracts, isolated configuration, and explicit approval for external changes remain separate gates. Do not tell the provider that complete integration testing succeeded.

Next physical checks: open a saved draft, verify exact variant and terms, create/recover a second selection, confirm draft consent and reopen it after restart. Then test the connected canonical plan when implemented. Do not substitute fabricated balances or client-side activation to make the journey appear complete.
