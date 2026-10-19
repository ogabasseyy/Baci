# Mobile native crash fixes — draft validation

## Changes

- Keep shared ownership of the Fabric root during deprecated shadow-node lookup, including when the upstream feature flag is disabled. Compile React Native from source on Android so the repository C++ patch reaches the APK.
- Build Expo native modules from source on iOS to avoid mixing incompatible precompiled ExpoModulesCore/ExpoModulesJSI binaries. Check the packaged IPA's JSI symbol imports before upload. Add a Swift compiler regression for the RuntimeScheduler constructor compatibility patch.
- Initialize Facebook SDK settings before loading dependent native modules; skip Facebook loading when local configuration is absent. Observe late ad-initialization outcomes without reporting a startup deadline as an SDK failure.
- Allow local Sentry configuration without upload credentials while preserving required production configuration validation.
- Bound the checkout pattern/gradient to its measured container and remove the continuous decorative home service-card border animation.

## Physical-device evidence

Android: production-derived build 814 reproduced a SIGSEGV during checkout keyboard focus traversal. A local source-built candidate (817) completed 90 Tab transitions with the same process ID and no captured matching fatal crash. This is bounded debug-candidate evidence, not release parity or proof that every Android ANR is resolved.

iOS: the actual TestFlight 575 artifact matched the missing Expo JSI symbol reported by the device. The packaged-symbol gate rejects that artifact. Source-built local candidate 900001 passes the gate and launches on iPhone 11 Pro. Candidate 900002 also passes and completes six keyboard focuses and three background/resume cycles.

The gradient's observed dimensions changed from 375 × 1500 to 375 × 812 points. Its first comparison trace recorded fewer microhangs but missed the last 0.724 seconds of the test. Subsequent recording attempts failed in Instruments' device connection session. A complete performance comparison remains pending; no clean performance verdict is claimed. The home-border removal is not installed in these candidates and has no device performance verdict yet.

## Review limitations and remaining gates

- Native concurrent lookup regression is included with the feature flag disabled, but its C++ stress test has not been run under ASAN. The physical focus test is independent evidence.
- Local iOS candidates used a development configuration with release JS/native compilation; production telemetry/configuration parity remains to be checked.
- Full tests in the investigation worktree were not green: mobile tests had generated-device-configuration and host sandbox failures; isolated launcher tests passed outside the sandbox. Web cost-tool test failures were also present. These results must not be represented as a green gate for this isolated branch.
- Complete a matching physical-device before/after trace, run release configuration checks and CI, and review before making this PR ready.
- No store upload, production deployment, Sentry resolution, or customer payment is part of this PR creation.

## Draft branch checks

The isolated branch passes the Swift compiler regression and four IPA symbol-gate fixtures, the eight focused storefront test suites, full lint, full typecheck and frozen lockfile-only validation. Local checks reuse the investigation workspace's installed dependencies to avoid another multi-gigabyte install; CI must verify a fresh frozen install. No application dependency versions were upgraded in the lockfile.

CodeRabbit's first pass reported one minor and two trivial issues, with no critical/major issues. Added assertions for both disabled Sentry Android upload flags and a late SDK rejection after startup resumes. Retained the flag-disabled native test: it deliberately protects against reintroducing the previous flag-gated unsafe path. These review/test results do not replace physical-device performance validation.

Final staged-file review reported five issues. Addressed the native-import rejection test and the optional Sentry environment assertion. Other dispositions:
- Static-link fixture: retained. A statically resolved symbol appears in defined output, not the unresolved `nm -u` input. Adding the same symbol to both lists would model contradictory inputs and weakening the provider check could mask an unresolved dynamic import.
- Android cache: the release workflow already uses `gradle/actions/setup-gradle` with caching. Additional CMake output caching and duration monitoring remain follow-up optimization work.
- Initial gradient height: retained zero until actual layout. A window-height guess can exceed an embedded container and reintroduce unnecessary drawing; the measured layout governs the decoration. Device visual/performance verification remains pending.
