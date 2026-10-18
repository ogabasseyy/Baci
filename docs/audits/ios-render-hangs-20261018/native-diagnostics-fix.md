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

The complete monorepo test run passed all six tasks, with no cached results:

- Web: 7,982 files and 51,035 tests passed; 68 files/215 tests skipped and one todo.
- Storefront: 1,464 Jest suites/8,842 tests and 64 Node configuration tests passed.
- Mobile admin: 926 files/4,661 tests passed.
- Shared: 232 files/1,605 tests passed.
- TikTok: three files/nine tests passed.
- Cloudflare qualification: one file/ten tests passed.

Two earlier attempts crashed inside Node 24.11.1's V8 garbage collector, without
test assertion failures. The crash stack matched the upstream
[Node issue 62393](https://github.com/nodejs/node/issues/62393). The successful run
used an isolated, checksum-verified official Node 24.22.0 runtime with the issue's
`--no-sparkplug` workaround applied only to Jest processes, and serialized package
tasks. The global Node installation, repository runtime pins, test configuration
and assertions were unchanged. The successful log is
`/tmp/baci-sentry-full-tests.log`; failed attempts are retained as
`/tmp/baci-sentry-full-tests-concurrent.log` and
`/tmp/baci-sentry-full-tests-serial-node2411.log`.

## Delivery and limits

Changes are local and require a new native build/release. MetricKit subscriber
installation and SDK filtering are verified; receiving a real Apple-generated hang,
CPU or disk diagnostic in production is not. OS diagnostics may be sampled/delayed.
Existing custom hang alerts remain available while MetricKit evidence accumulates.
This does not by itself prove that the unresolved production rendering hangs are
fixed. No Sentry issue has been marked resolved.
