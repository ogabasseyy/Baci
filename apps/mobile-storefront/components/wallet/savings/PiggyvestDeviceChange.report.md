# Native connected purchase, device change and closure — local checkpoint

## Changes and ownership

Added PiggyvestDeviceChangeReview.tsx/.test.tsx, PiggyvestDeviceChangeBinding.tsx/.test.tsx, StartSavingsScreen.device-change.test.tsx, StartSavingsScreen.closure.test.tsx and StartSavingsScreen.combined.test.tsx. Updated only owned PiggyvestSavingsScreen.tsx and PiggyvestSavingsScreen.types.ts to integrate optional deviceChangeBinding/deviceChangeSelection and draftClosureBinding. Existing purchase/cancellation/schedule presentation remains connected; all five use reciprocal live sibling guards and pure snapshot subscriptions. Native screen280, device review137 and binding161 runtime lines at this checkpoint.

Device selection contains exact goal/quote/product/variant identifiers, never price or default duration. The server quote supplies replacement labels, price, duration, maturity/grace deadlines and exact terms. Shared controller validates prior revision and retains the exact operation/command. Native explicit checkbox never activates funding. Pending, unknown and confirmed-but-historical outcomes hide cached bank/progress. Recovery is read-only historical evidence; no new ID, automatic resend, balance update, wallet replacement or funding permission follows from it. Changed/invalid identity fails closed; absent optional bindings preserve existing behavior.

Closure uses Leibniz's existing component/controller unchanged by this agent. Only server-available unfunded/unexposed review offers confirmation. Provider-exposed/mapped reconciliation states never imply zero funds, closure, refund or wallet deletion. Unknown closure removes confirmation and allows only status readback. No backend schemas, shared files, SQL, registry, router or production route edits by this agent.

## Verification

- Native device review RED missing component, GREEN2.
- Parent StartSavingsScreen device tests RED4 before integration, GREEN4 for pending/confirmed/unknown bank invalidation, recovery-only and invalid/session-mismatched binding.
- Actual native React screen + actual shared bounded HTTP client + explicitly synthetic transport: GREEN3 for exact command serialization and post-CSRF unmount/sibling invalidation guards. This is not an installed-network, socket or PG assertion.
- Actual parent-screen closure tests GREEN3: server-confirmed closed with no refund/deletion, unknown no retry, exposed reconciliation no close.
- Consolidated **16 suites / 81 tests GREEN**, `/tmp/piggy-native-connected-final.log`. Run the eleven-suite command in PiggyvestPurchase.report.md plus `components/wallet/savings/PiggyvestDeviceChangeReview.test.tsx components/wallet/savings/PiggyvestDeviceChangeBinding.test.tsx components/wallet/savings/StartSavingsScreen.device-change.test.tsx components/wallet/savings/StartSavingsScreen.closure.test.tsx components/wallet/savings/StartSavingsScreen.combined.test.tsx` using the same `--runTestsByPath` invocation.
- All-five mounted real-controller regression initially RED (`/tmp/piggy-native-five-controllers.log`): device change temporarily blocked siblings but poisoned closure lifetime and removed its controls. Shared owners separated transient compatibility from lifetime; native paired/all-five tests now pass. Close callback occurs once, schedule remains mounted/disabled during close pending, acknowledgement loss keeps closure recovery accessible, and recovery does not permit another close. The separately named `/tmp/piggy-native-combined-red.log` actually ran after the concurrent fix and is GREEN, not RED evidence.
- Native `pnpm --filter @baci/mobile-storefront exec tsc --noEmit --incremental false` exit0: `/tmp/piggy-native-device-types.log`.
- Scoped Biome applies only owned new/updated native files. Parent owns root verification and final acceptance.

## Remaining gates and freeze status

The purchase and additive device/closure source checkpoints were independently reviewed by Hooke with no remaining confirmed bounded P1/P2; the requested real-controller combined regression is included. Owned native source is stable/frozen for parent review, not a release/live freeze. Existing frozen migrations and held 4179/4181/4183 evidence were untouched.

Use the real authenticated owner to supply the strict source, stable tenant/session/goal controller lifetime and exact selection. On reload retain the original operation and use recovery mode; a brand-new controller is not evidence that another operation is safe. Native production transport/authentication remains unverified: see the installed Expo cookie/redirect/body-limit audit and safe next simulator prerequisite in PiggyvestPurchase.report.md. No credentials, provider calls, device builds/installs/launches or remote actions were used. Backend HTTP/PG and provider certification are separate evidence layers; synthetic callback/transport results never establish financial authority.
