# Native Sentry breadcrumb filtering and MetricKit

## Implementation

The storefront's Expo plugin configures the native `RNSentrySDK.start` callback
before the Cocoa SDK starts. It drops HTTP-type breadcrumbs and HTTP/fetch/XHR
categories before they enter the native bounded breadcrumb store. Existing
callbacks still apply to non-network breadcrumbs. Navigation, focus, UI/keyboard
lifecycle and memory warnings are preserved.

The callback enables the installed Cocoa 9.19.1 MetricKit integration without raw
payload attachments. Existing ANR/hang tracking stays enabled. There is no SDK
upgrade, dependency patch, alert suppression or Sentry issue-resolution mutation.

Expo runs AppDelegate mods in reverse registration order. The policy mod is
registered before Sentry so it executes after Sentry generates its initializer.
A generated marker preserves the upstream plugin's incremental-prebuild detection;
clean and incremental prebuilds produce one configured native initializer.
A missing/changed initializer fails the build rather than silently shipping
without the diagnostics policy. The plugin is omitted if Sentry is not configured.

When Expo provides its native options prelude, JavaScript explicitly preserves
native startup ownership in development as well as production. Otherwise Sentry's
development reinitialization would replace the native callback. Builds without
the prelude retain the existing JavaScript initialization behavior.

## Regression and native verification

- The old/no-policy case fails: native HTTP reaches captured events, a 150-request
  burst evicts earlier route/memory breadcrumbs, and MetricKit is absent.
- The new policy passes 22 assertions against real Cocoa SDK objects and the SDK's
  native breadcrumb/capture pipeline in an iOS 27 simulator. The test's local
  `beforeSend` consumes its synthetic event; it uses a loopback-only dummy DSN and
  a disposable cache. No customer/provider request or external event is sent.
- Captured SDK integration metadata confirms both `MetricKit` and `ANRTracking`
  are installed. Raw MetricKit payload attachments stay disabled.
- Four Node tests exercise the real Expo/Sentry mod composition, idempotency,
  missing/duplicate initializer failures and conditional registration.
- Twenty focused Jest tests pass across initialization and Expo/Sentry config.
- The full iOS simulator Debug build passed with the actual generated AppDelegate,
  including the native diagnostics callback. The local generated AppDelegate was
  restored afterward; release builds generate it through Expo prebuild.
- macOS PR/release gates run the native SDK probe and mod-composition tests.
  Workflow actionlint, shellcheck and changed-file Biome checks passed.

## Broader validation

Full monorepo lint passed. Typecheck reported seven pre-existing typed-route errors:
six in EliteSlide/FashionSlide/StandardSlide test fixtures and one in WalletScreen.
An archived, unchanged `d56d122dfe` source snapshot with the same generated Expo
route types reproduces exactly the same seven errors. No errors arise in changed
TypeScript. These unrelated files were preserved.

The complete monorepo test task is pending final verification.

## Delivery and limits

Changes are local and require a new native build/release. MetricKit subscriber
installation and SDK filtering are verified; receiving a real Apple-generated hang,
CPU or disk diagnostic in production is not. OS diagnostics may be sampled/delayed.
Existing custom hang alerts remain available while MetricKit evidence accumulates.
This does not by itself prove that the unresolved production rendering hangs are
fixed. No Sentry issue has been marked resolved.
