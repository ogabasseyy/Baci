# Native cancellation review — ready for parent review

New isolated component PiggyvestCancellationReview; no screen binding or native transport changes. Props mirror web: sessionKey, goalId and operationId (string|null), quote:unknown, onPrepare:(shared confirmation)=>Promise<unknown>. Caller supplies a stable operation ID and trusted authenticated quote. Shared piggyvestCancellationReviewSchemas validates quote/confirmation/receipt without duplicated schema logic or actor/config fields.

Existing savings styles, theme colors, Text/View/Pressable and accessible checkbox/button controls are reused. Principal, paid interest and pending interest are separate. 0% fee appears only for the supported literal consent policy. Exact terms version/hash and quoted amounts are confirmed explicitly. Preparation never claims refund, interest disposition or provider dispatch completion.

UUID comparison and attempt keys are canonical; original command UUID strings are preserved. Full quote/goal/session/operation/callback replacement resets consent and suppresses old completion through state-token equality. Unmount disables both late success and failure. Unknown or mismatched receipts retain a blocked operation; there is no automatic retry, new ID or reservation-release claim. Caller must reconcile uncertain status before remounting an actionable flow; local attempt state is not durable idempotency.

## Verification

- Initial test run failed before component existed.
- Exact same-tick duplicate-tap regression then failed (two callback calls), fixed by checking attempted.current inside prepare before dispatch.
- Final: pnpm --filter @baci/mobile-storefront exec jest --runInBand components/wallet/savings/PiggyvestCancellationReview.test.tsx components/wallet/savings/PiggyvestCancellationReview.lifecycle.test.tsx --silent — 24 passing across two suites.
- Scoped Biome clean on all three new TypeScript files. Runtime 243 lines; both test files below 300 lines.
- Existing Watchman recrawl/Jest force-exit notices remain. No native app/device launch, install, network, provider, environment or deployment actions.

Files: PiggyvestCancellationReview.tsx, PiggyvestCancellationReview.test.tsx, PiggyvestCancellationReview.lifecycle.test.tsx, this report, all under apps/mobile-storefront/components/wallet/savings.

## Parent integration and actionable web finding

Parent owns screen binding, transport, backend revalidation, stable operation IDs and root checks. No shared/existing files edited.

The inspected web cancellation-review.tsx has the same pre-render duplicate race: blocked captures attempted.current.has(operationKey), but prepare does not re-read it. Two same-tick calls can both dispatch. Native failing regression demonstrates this pattern and the fix: add attempted.current.has(operationKey) to the guard inside prepare. Web is outside this slice; parent should reproduce/fix it there.
