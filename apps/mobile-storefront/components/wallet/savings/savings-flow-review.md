# Mobile savings flow — ready for parent review

Local synthetic verification, 12 September 2026. Existing dirty work preserved. No provider activation, Paystack contract changes, secrets/env/proxy edits, device launches/writes, installs/builds or remote operations.

## Verified defects and fixes

- Explicit deleted route variant with no remaining variants previously became an apparently valid base-price choice. Preserve the requested variant identity through resolution; invalid explicit variants remain unresolved and do not auto-fill the base target. Final submission now rejects unresolved exact-variant selection, independently of earlier preview validation.
- A mounted product/variant route change was ignored after selection. Matching refreshed catalog rows were also ignored, leaving stale prices or removed variants selected. Reconcile route changes and matching refreshed rows, preserving the requested variant across disappearance. Search results that omit the selected product do not clear it. Existing custom target preservation remains unchanged.
- Late create-success/failure could mutate the UI for a newly selected device. A per-context lifetime guard invalidates on merchant/device/form changes and unmount, including A-to-B-to-A. The submission runner checks after creation, after reminder work, and before refresh-error UI. The in-flight lock remains until settlement; this does not abort/undo a dispatched request or prove a financial outcome. Existing idempotency behavior is preserved.
- Switching merchant during saved-card loading retained the previous merchant's selected card; a failed replacement request could leave it selected. Clear cached options and selection immediately on fetch-scope change. Regression also verifies a cancelled old response cannot populate the newer context or clear its loading state. No authorization/provider code changed.

## Follow-up rereview fixes

All three follow-up findings reproduced before their fixes (7 failed assertions across the three targeted suites; 9 controls passed):

- A-to-B route transition with B absent retained A's auto-filled 750000 target when B arrived at 950000. Retain the last selected choice as auto-target provenance across the empty loading interval. Real hook state regression now verifies 950000 replaces the old auto-target, while a manually entered 123456 remains unchanged.
- The controller does not reset contribution idempotency state on selection change. A stale confirmed-success response previously returned before retirement, leaving attempt-a for a different operation. On strict success=true, retire via a functional setter only if currentKey equals the request's key, before suppressing stale UI. Preserve newer attempt-b, preserve indeterminate/unsuccessful requests, and reuse attempt-a for retry of the same operation. No key is retired when this request had no contribution key. This confirms only the application's creation response, not provider funds finality.
- Extract the existing card authorization runner into run-savings-card-authorization.ts and pass the existing context lifetime guard. Suppress late navigation, modal setters and error alerts after merchant/form context change or unmount; guard completion state updates after unmount. Four failing-first hook regressions cover switched/unmounted success and failure. Existing authorization amount, request payload and route parameters are unchanged. A dispatched provider request is NOT cancelled or undone, and no automatic retry was added.

## Evidence

Failing-first regressions reproduced: deleted variant returned requiresVariantSelection=false with base price; unresolved final submission invoked the runner; mounted route retained variant-128 instead of variant-256; late success and failure mutated old UI setters; changing merchant retained the old card. After fixes all savings-directory tests pass.

```
pnpm --filter @baci/mobile-storefront exec jest --runInBand --watchman=false components/wallet/savings
Test Suites: 22 passed, 22 total
Tests:       138 passed, 138 total
Time:        19.219 s
```

Final Biome: Checked 12 files in 137ms. No fixes applied. Scoped git diff --check also passed. The command includes the three new follow-up files below.

```
pnpm exec biome check apps/mobile-storefront/components/wallet/savings/use-start-savings-product-selection{,.test}.ts apps/mobile-storefront/components/wallet/savings/use-start-savings-submit{,.variant.test}.ts apps/mobile-storefront/components/wallet/savings/run-savings-goal-submission{,.test,.idempotency.test}.ts apps/mobile-storefront/components/wallet/savings/run-savings-card-authorization{,.test}.ts apps/mobile-storefront/components/wallet/savings/use-start-savings-payment-methods{,.test}.ts apps/mobile-storefront/components/wallet/savings/start-savings-controller.utils.ts
```

Existing test setup emits storage debug output, an Expo Go notifications warning, and Jest's forced-exit advisory. These were not suppressed. No actual native UI or provider behavior is claimed. Parent owns broader type/root checks.

## Stable files changed in this slice

All paths below are relative to apps/mobile-storefront/components/wallet/savings/:

- start-savings-controller.utils.ts
- use-start-savings-product-selection.ts
- use-start-savings-product-selection.test.ts
- use-start-savings-submit.ts
- use-start-savings-submit.variant.test.ts (new)
- run-savings-goal-submission.ts
- run-savings-goal-submission.test.ts
- run-savings-goal-submission.idempotency.test.ts (new)
- run-savings-card-authorization.ts (new)
- run-savings-card-authorization.test.ts (new)
- use-start-savings-payment-methods.ts
- use-start-savings-payment-methods.test.ts
- savings-flow-review.md (this report)

Other dirty savings files were not authored by this slice. Runtime files remain below 300 lines.

## Read-only native prerequisites

Observed locally: Android adb and emulator binaries exist in /Users/mac/Library/Android/sdk; the shared Baci_Pixel_9_Pro_XL_API_36_Google AVD directory exists; xcode-select points to /Applications/Xcode.app/Contents/Developer. No listener was observed on TCP 8082. These checks do not prove a booted/healthy device, installed app, available simulator runtime, connected phone or compatible build.

Future authorized Android QA must use the storefront scripts: `pnpm --filter @baci/mobile-storefront android:emulator`, `android:metro`, and `android:launch` (installation only when separately approved). Do not substitute the admin launcher. Storefront uses com.ogabassey.store, ogabassey scheme, Metro 8082 and emulator access through 10.0.2.2. The two app launchers share the QA AVD/port 5554, so coordinate sequential use. A development build is needed rather than assuming Expo Go supports the native modules.

Simulator QA requires an available compatible Xcode simulator runtime and preinstalled approved synthetic development build. Phone QA additionally requires an explicitly authorized test device, trusted/debug connection and a reachable synthetic Metro/backend setup. No adb/simctl inventory or launch commands were run; no phone connection or installation is asserted. Live merchant/customer data and money paths remain excluded.

## Read-only wallet recovery observation outside ownership

Inspected WalletSavingsProgressModal.tsx and WalletSavingsVariantResolutionModal.tsx without edits. Completed unresolved goals expose explicit variant recovery rather than guessed selections. The latter modal guards late success by visibility-session identity but its catch still alerts unconditionally after an old rejected request; a follow-up owner should reproduce a late rejection after external dismissal before changing it. No outside-scope fix or native validation is claimed.
