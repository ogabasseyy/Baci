# Native startup and navigation validation

The Android startup changes were exercised on a physical Samsung Galaxy S8+
(SM-G955F, Android 9, ARM64) using an R8-optimized, non-debuggable local benchmark
APK. Existing app data was retained. These are local observations, not store
release, production deployment, or iOS device validation.

## Observed behavior

- Native artwork plays once. Heavy navigation/Home mounting waits for native
  intro completion; the final artwork remains visible until readiness and the
  first app layout allow dismissal.
- Cold launcher entry reaches Home. Update prompts and push-response navigation
  wait until splash handoff; interrupted/late native completion is latched.
- Missing font/storage readiness has a retry UI instead of a permanently covered
  or absent navigator. Failure paths have targeted regression coverage; device
  fault injection and Activity destruction/recreation were not established.
- Search waits for keyboard dismissal before pushing a product route, with a
  bounded missing-event fallback and cancellation on close/background/unmount.
- Hidden/background carousel timers stop, and startup motion can be suspended.
- Closed image zoom avoids initializing gestures until opened; opening,
  thumbnail selection, closing and reopening were checked on the Samsung.

Matched early-intro main-thread trace windows before/after the native completion
mount gate recorded maximum callback durations of 269.11/13.84 ms and p95 of
26.74/9.56 ms. Three subsequent intro presentation captures had p95 presentation
intervals of 18.42–18.69 ms and no interval over 50 ms in their six-second windows.
These are different metrics, small samples, and not a guarantee of 60 FPS.
Holding the last scene for readiness does not claim faster total startup.

These measurements precede synchronization of the PR with newer main commits.
They motivate the changes; current-head CI and further device verification remain
separate release gates. PostHog startup receipt and one explicitly opted-in,
non-crashing Sentry diagnostic were previously verified in the benchmark project;
other historical crash reports are not declared fixed.

## Native build requirements

A new native binary is required. Use the existing release workflow's clean Expo
prebuild; local benchmark instructions are in `android-startup-benchmark.md`.
Config plugins, patched native modules, source artwork and its generator are
versioned. Machine-generated benchmark native output and private build settings
are not part of this change. The `splashmotion1` runtime generation prevents
sending this JS/native API to older installed binaries.

The storefront pins Nitro 0.37.2 with the RN 0.88 compatibility patch required
by SplashMotion. Mobile-admin remains on its existing Nitro 0.35.9 patch; this
PR does not change its declared or resolved Nitro version. Mobile-admin and iOS
native builds/device behavior require their own validation. Do not treat Android
storefront evidence as proof for those targets.

The release workflow checks that the AAB contains the required native libraries
and ELF architecture headers for all four configured ABIs (`armeabi-v7a`,
`arm64-v8a`, `x86`, and `x86_64`) before Play generates device-specific splits.
That packaging gate does not verify dynamic symbol compatibility or prove that
the libraries load at runtime. Physical-device installation and launch remain
the runtime loadability check; the startup observations above cover ARM64 only.

When upgrading React Native, Hermes, Nitro or SplashMotion, or changing the
storefront ABI matrix, inspect a clean release AAB for the native libraries
required by that dependency set and update the expected list and fixtures in
`.github/scripts/android-native-library-check.mjs` and its tests. Keep the
physical-device launch check: changing the expected list only updates the
packaging contract and cannot establish symbol compatibility.

## Product-page performance remains open

The preview-gated product page, cached-photo loading, image fade change and
section/selection batching experiments are kept on a separate development branch.
They are not included in the proven-startup draft PR.

Forty-six sequential Samsung entry measurements found mixed results. In the final
experimental candidate, iPhone median post-slide maximum main-thread duration was
60.29 ms versus 84.58 ms in the baseline, but all five runs still exceeded 50 ms;
the charger median rose from 46.14 to 50.71 ms. A persistent-photo experiment was
reverted after worse results. Zoom deferral alone did not consistently eliminate
the spike. The small zoom lifecycle cleanup in this PR is not advertised as a
product-page jank fix.

Further investigation must isolate gallery/thumbnails, detail mounting and
background work with separate release-like captures, retaining whole-operation
frame tails and functional price/stock/selection checks. No product-page smoothness
or universal crash-freedom claim is made here.

## PR runtime launch check

The Android APK built from d442a5a2b8 (after synchronizing main) was installed
without clearing data and cold-launched on the Samsung. It reached Home with an
empty cart and no fatal entry for that process. Startup markers reported native
intro completion, then router/first layout, then splash-hide completion, each
once. Times relative to JS entry were 5.327 s, 6.052 s (first layout), and 7.157 s
(hide completion). These are event timings, not display-frame measurements.
The subsequent server-off coverage follow-up changes tests/documentation only;
it does not change the runtime exercised by this APK.
