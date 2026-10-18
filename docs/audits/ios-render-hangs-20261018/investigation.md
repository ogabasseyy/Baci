# iOS BNPL checkout and rendering hangs — 18 October 2026

## Observed production evidence

- [4B](https://ogabassey-services-limited.sentry.io/issues/154380893/), event
  `53774da195da406f938f14a266810615`, 18 October 05:37:08 UTC:
  `com.ogabassey.app@2.1.634+634`, source `0f8d3a8bca07ed0e1520ab6b471a38fe682faffd`,
  route `/bnpl-checkout`. iPhone10,3, iOS 16.7.7, serious thermal state,
  85,622,784 bytes free memory. The 7.5–8.3 second fully blocked sample enters
  `RCTScrollViewComponentView.mountingTransactionDidMount`, recursively forwards
  `updateClippedSubviewsWithClipRect:relativeToView:`, and walks CALayer ancestry
  during coordinate conversion. The active route does not identify which retained
  scroll view owns the sample; BNPL's screen has no React Native ScrollView.
- [4A](https://ogabassey-services-limited.sentry.io/issues/154270947/), event
  `add57b559cdd49e2a60a8cd8f73ed449`, 17 October 12:34:07 UTC:
  `2.1.632+632`, source `0ee6529a567f2aa91a6620915d00460214d700fb`, route `/(tabs)`.
  A 4.1–4.9 second sample enters scroll-view `updateState:oldState:` and CALayer
  frame updates on iPhone11,8 / iOS 18.7.10, also with serious thermal state and
  low available memory. It is a different sampled path from 4B.
- [2T](https://ogabassey-services-limited.sentry.io/issues/143807900/), event
  `6d1b9b106fbd4a14bd92db3afa3583c7`, 17 October 10:19:49 UTC:
  `2.1.632+632`, route `/product/[slug]`, iPhone14,2 / iOS 26.6. Sentry reports
  103.1–103.9 seconds, but its captured main stack is waiting in the run loop.
  Breadcrumbs show keyboard presentation and product navigation. This sample
  alone cannot locate a 103-second blocking function or prove a keyboard deadlock.

Heat and memory are context, not established root causes. No issue is marked
resolved by local tests, and no production release is part of this validation.

## Changes and rationale

1. Fabric's generic UIView clipping forwarder converted the clipping rectangle
   at every ordinary UIKit descendant, including leaves. Those views do not
   perform clipping. Forward the rectangle with its original coordinate view;
   `RCTViewComponentView` still performs the conversion when clipping is enabled.
   Nested scroll views retain their independent clipping boundary. This removes
   the unnecessary CALayer work in 4B's sampled path; it does not establish that
   all production stalls have the same cause.
2. Enable native-stack `freezeOnBlur` at the root, as already used by the tabs.
   Older covered home/product/checkout routes retain state without reconciling
   updates behind the provider page. Native-stack intentionally keeps the screen
   immediately below the focused Fabric screen live for transitions; this change
   preserves that behavior. It is not an unconditional freeze of every hidden view.
3. Enable `ios.buildReactNativeFromSource` in Expo config and native properties.
   The prebuilt React Native core bypasses local renderer patches. Existing
   Android patches remain intact, and Android build selection is unchanged.

## Regression method

The native probe compiles the exact installed forwarding, clipping-view and
independent-scroll-view methods against UIKit in an iOS simulator. It uses real
UIView geometry and counts actual `convertRect:toView:` calls. It does not assert
source text or replace coordinate conversion with a mock.

Before the fix, the plain 1,041-view tree made 20,820 conversions over 20 updates;
its no-conversion and clipping-only conversion assertions failed. With the patch,
that subtree makes zero conversions. Geometry tests cover translated/scaled
wrappers, offscreen removal, remounting after scrolling, nested clipping,
independent scroll views and content awaiting layout. Timing is diagnostic only;
no host-dependent latency threshold is used as a correctness gate.

Native regression runs in the macOS PR and storefront release gates. It reuses a
booted simulator or boots an available one, and shuts down only one it booted.
Root-stack and build-config regressions also failed before their changes.

## Simulator flow and trace

A disposable Debug app (`com.ogabassey.renderprobe`) on iPhone 18 Pro / iOS 27.0
used the actual BNPL WebView component with a local HTTP checkout page. The flow
was home → product → checkout → back → home, with native input focus and a page
JavaScript/DOM round trip. No provider, account or payment request was made.

The same patched native binary ran with root-stack freezing enabled and disabled.
During a two-second covered-home interval, the enabled run made **0** home renders
and the disabled run made **19**. Both loaded the WebView, executed its page script,
focused the native field and resumed home updates with one retained home instance.
See `simulator-flow-results.json`. This is a navigation comparison, not a renderer
before/after performance claim. The software keyboard and WebView input focus were
not observed; they are not counted as passing keyboard coverage.

ETTrace v1.1.0 captured the focused flows with UUID-matched app/framework dSYMs.
Processed artifacts are retained locally:

- `/tmp/baci-ios-render-profile-candidate/output_259.json`
- `/tmp/baci-ios-render-profile-unfrozen/output_259.json`
- Corresponding `analysis.txt` and `runner.log` files beside each trace.

React Native clipping/mounting frames are symbolicated. Unresolved app frames are
below 0.004% of each trace; many system-framework frames have library names only,
so these captures cannot support detailed UIKit/WebKit attribution. Capture windows
and loading/idle time differ; total CPU durations are not compared. Earlier setup
runs with onboarding overlays or an unsupported data URI are excluded from results.

The disposable fixture source is retained in `/tmp/baci-ios-render-probe-fixture/`.
Temporary QA app, Metro and report server were removed/stopped; the simulator booted
for this investigation was shut down. The production simulator app was not replaced.

## Validation status

- Full monorepo lint/typecheck: 10/10 tasks passed.
- Storefront Jest: 1,464 suites / 8,841 tests passed, plus its Node contract checks.
- Mobile-admin: 926 files / 4,661 tests passed.
- Web: 7,978 files / 51,031 tests passed initially; four failures were isolated to
  CLI package-manager lookup and clean-worktree/committed-lockfile prerequisites.
  Both CLI tests passed when rerun with the pinned pnpm 11.7.0 first on PATH.
  Both Git-authority tests then passed on clean task commit `f78d46e8cf`.
  All four initial failures passed in targeted reruns; the complete broad run itself
  is recorded as initially failing rather than represented as a new all-green run.
- Shared: 232 files / 1,605 tests passed separately after web stopped the Turbo run.
- Cloudflare worker: 10 tests passed; TikTok package: 9 tests passed.
- Native clipping: 10 checks passed after failing on the old forwarder.
- Platform drift, native ad-config guard, workflow actionlint and probe shellcheck
  passed. No package versions or package metadata changed in the pnpm lockfile.
- The normal source-built simulator app passed Xcode compilation. Temporary
  ETTrace wiring was removed; the final ordinary Debug rebuild also passed, with
  the normal bundle ID and no QA URL scheme or ETTrace framework.
- Manual diff review completed; CodeRabbit remains skipped per the user's waiver.

The sampled 4B conversion overhead and covered-route updates have concrete fixes
and regression evidence. The original production 7.5-second stall, the separate
4A frame-update hang and 2T's long idle-stack report were not reproduced. Physical
iOS 16.7 behavior under thermal/memory pressure, software keyboard/autofill and
provider-hosted authentication remain unverified. A new native release is needed;
these changes have not been merged, released or marked resolved in Sentry.
