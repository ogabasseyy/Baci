# Expo SDK 58 mobile upgrade

Both mobile apps move together from Expo 57 / React Native 0.86.2 / React 19.2.3 to Expo 58.0.19 / React Native 0.88.0 / React 19.3.0. Implementation began from origin/main at de0e4a5f2fab01aa06964293d0c713fbea07ae6b; the branch was subsequently rebased onto origin/main at bb10afdf07e1825a29948dda873274b7c05040cd. The original checkout and its uncommitted work are separate from this branch.

## Runtime and native configuration

- Expo module versions follow the SDK 58 bundled dependency matrix. Reanimated 4.7.1 and Worklets 0.13.0 remain aligned, and automatically installed React Native peers use 0.88.0.
- Native refs use the public instance types. Removed InteractionManager calls use cancellable idle callbacks. Sign-out teardown, retry and unmount behavior have focused tests.
- Floating tab bars use SDK 58 emitter and navigateToTab props. Admin requests route prefetch through the SDK 58 router; inactive-screen mounting and first-tap performance have not been verified on a device. Storefront tabs retain their existing no-preload policy.
- OAuth callback parsing uses public URL APIs instead of an unexported Expo Auth Session internal module. Query/fragment precedence, missing codes and malformed URLs are tested.
- Metro resolves React and React DOM from each app so hoisted dependencies share its React instance. Vitest uses published ESM entries for Testing Library and React Native Web to honor the app-specific aliases; the web app retains React 19.2.3.
- Android uses compile SDK/build tools 37, target SDK 36 and Gradle 9.4.1. iOS uses the SDK 58 scene lifecycle. Existing tracking-consent defaults, Facebook credential injection and Sentry/PostHog build wrappers are preserved in checked-in native projects.

## Patch decisions

The RN root-ownership race fix is upstream in 0.88. The removed StatusBar color/translucency API no longer needs its old patch. The iOS clipping traversal optimization and Android WindowUtil deprecation fixes remain patched. Storefront compiles the patched iOS core; admin retains its existing prebuilt iOS core, so the clipping optimization is not claimed for admin. Precompiled Android Hermes must match RN's sdks/hermes-engine/version.properties (260318099.0.4), rather than the stale source tag in .hermesv1version. Storefront source-build wiring substitutes only ReactAndroid; Hermes stays on the matching binary selected by the RN Gradle plugin.

Expo core's weak EventEmitter reference and scene-aware authentication/browser/printing presentation fixes are upstream in SDK 58. The SDK 58 core patch restores the legacy window fallback and its synchronous main-queue contract. The installed Apple authentication request is dispatched on the main queue; core's current-view-controller call is already inside a main-actor assertion. Installed print and web-browser sources call SceneGeometry directly, not this patched helper. The synchronous helper returns nil off the main thread instead of accessing UIKit or trapping; callers needing a window must hand off to the main actor. On scene-configured apps it also returns nil until a scene window is available; early presentation must wait for a connected foreground scene. Cold-launch authentication and presentation have not been verified on a device. The gradient composition optimization remains patched. Screens' RecyclerView transition cleanup is rebased on 4.30.0. Gradle DSL fixes are rebased only where still needed. Bottom Sheet's TextInput ref declarations and WebView's default props generic receive type-compatibility patches.

Nitro 0.35.9 receives the upstream RN 0.87+ JSI installer selector backport, preserving its runtime CallInvoker. An iOS launch exposed this incompatibility after compilation passed; the regression guard fails without the selector. Upstream reference: https://github.com/mrousavy/nitro/issues/1435.

The image-size 1.x parser dependency and Metro 0.84 patch targets disappear from the SDK 58 dependency graph. Regression guards verify that the obsolete image-size dependency is not reintroduced.

Both apps use new SDK58/RN0880 OTA runtime identifiers, separating these binaries from SDK57 updates even when the public app version is unchanged.

## Test-runner decision

Jest remains on 29.7.0 with @types/jest 29.5.14 and jest-expo 58.0.12. The installed jest-expo package explicitly supports Jest ^29.0.0 or ^30.0.0; the SDK dependency checker recommends Jest 30 as its default. Jest and @types/jest are therefore explicit tooling exclusions, and jest-expo's watch-typeahead dependency is pinned to the existing Jest-29-compatible 2.2.1. This preserves the supported test runner while keeping a separate Jest 30 assertion-type migration outside this runtime upgrade. No new runtime dependency exclusions were added.

## Verification

| Check | Result |
| --- | --- |
| Frozen pnpm installation | Passed |
| Expo dependency validation | Both apps passed, with the documented existing runtime pins and Jest tooling decision |
| Full monorepo lint | 5 tasks passed |
| Full monorepo typecheck | 7 tasks passed |
| Clean Android/iOS prebuild | Both apps passed; generated OTA runtimes and wrapper checksum verified |
| Android Debug native build | Both apps passed; storefront resolves Hermes 260318099.0.4 |
| Production Android JavaScript export | Both apps passed; each source map contains one app-local React package |
| Native tracking/Sentry/scene guards after CocoaPods | 22 tests passed |
| Platform drift checks | Both apps passed |
| Other monorepo package tests | Shared: 295 suites / 1,941 tests; TikTok: 3 / 9; widget: 3 / 9 plus one skipped; qualification worker: 1 / 10 |
| Admin regression suite | Latest full run: 930 suites / 4,725 tests passed; one five-second shipment-test timeout passed in a single-worker rerun (all 4,726 tests covered) |
| Storefront regression suite | Full Jest rerun: 1,608 suites and 9,924 tests passed; all 72 additional Node/config tests passed |
| Full web regression suite | Initial run: 8,866 suites passed and 10 failed. Nine failed files passed in reruns (75 tests); the lockfile attestation passed against local upgrade commit 66b97d98ec |
| iOS simulator native builds | Both final Nitro-compatible builds passed on the iOS 27 arm64 simulator, including locally signed simulator builds |
| Android/iOS interactive smoke checks | Android launcher settled; admin sign-in, keyboard and password-reset navigation rendered; storefront catalog/product rendered. Account tab/login, back navigation and drawer also passed; cart press reaches the handler but live service returns temporarily_unavailable; checkout remains unverified. iOS admin welcome, sign-in, text entry/clearing and password-reset navigation passed. iOS storefront startup, catalog/product rendering, drawer, account-to-login and back navigation passed |

Storefront production export used explicitly synthetic provider configuration and disabled source-map upload. No provider credentials or `.env` files were copied into this branch. Native builds are local Debug verification, and do not establish production delivery or physical-device provider behavior. Final iOS smoke tests use Xcode local ad-hoc signing so the simulator receives its normal simulated Keychain entitlements. Tracking permission was declined during simulator checks.

The initial whole-diff CodeRabbit request exceeded its 150-file limit. Scoped reviews completed for both mobile apps and shared GitHub tooling: admin raised zero issues; the storefront checksum, OAuth fragment error, scene-test coverage and splash regression were addressed. The tooling observation referred to the baseline migration helper; the updated helper passes the exact conditional/unconditional suite tests. CodeRabbit does not review the patch-file scope; a fresh whole-branch reviewer also examined the upgrade.

Storefront product details respect reduced-motion settings: essential content no longer remains transparent when Android animations are disabled. The storefront Expo scripts no longer globally preload tsx, which caused an SDK 58 config-loader cycle; public-config CLI regressions cover each entry point.

Authenticated admin tabs/domain sheet, sign-out, notifications, purchases and production analytics require a test account or physical-device/provider coverage. No credentials were supplied for those checks.

Merge, deployment, store submission and production account changes are outside this implementation. No performance improvement is claimed without measurements.

## Integration with pending work

The original checkout remains separate. A final path comparison found 16 overlaps, chiefly the two mobile manifests, root workspace/lockfile, admin configuration and Metro, several storefront components, and existing patch-integrity guards. Integration must reconcile those changes with the upgrade; replacing the original checkout wholesale would lose pending work. The overlapping paths at the final comparison were:

```text
apps/mobile-admin/app.config.ts
apps/mobile-admin/app/(admin)/(tabs)/index.tsx
apps/mobile-admin/app/(admin)/(tabs)/menu.tsx
apps/mobile-admin/metro.config.js
apps/mobile-admin/package.json
apps/mobile-admin/scripts/android-edge-to-edge-deprecations.test.ts
apps/mobile-storefront/components/auth/useLoginScreenController.ts
apps/mobile-storefront/components/quiz/QuizLeaderboardScreen.tsx
apps/mobile-storefront/components/storefront/Header.tsx
apps/mobile-storefront/components/storefront/SearchDropdown.tsx
apps/mobile-storefront/components/storefront/SearchOverlay.tsx
apps/mobile-storefront/expo-modules-jsi-patch-integrity.test.ts
apps/mobile-storefront/package.json
packages/tiktok-business/package.json
pnpm-lock.yaml
pnpm-workspace.yaml
```
