---
status: verifying
trigger: "Android users report that Ogabassey stops responding; investigate live telemetry, fix the error and any measurement gap, and add a guarded Codex response system."
created: 2026-08-04T17:24:46Z
updated: 2026-08-05T00:10:33Z
---

# Android Storefront ANR

## Symptoms

- expected: The Ogabassey Android storefront remains responsive while the home screen loads and while the user interacts with it.
- actual: Android displays the system "Ogabassey isn't responding" dialog over a rendered home screen, offering Close app or Wait.
- errors: No stack trace was supplied. The screenshot is Android's system ANR dialog, which indicates that the process is alive but its main thread did not service input in time.
- timeline: The screenshot correlates with a Galaxy A06 session on build 761 at approximately 15:45 UTC on 2026-08-04.
- reproduction: The exact build 761 Play artifact reproduces thousands of Reanimated main-thread exceptions immediately after the home screen renders.

## Current Focus

- hypothesis: The ChatWidget's infinite Reanimated pulse continues synchronously updating a view that contains an SVG icon after Fabric has discarded its surface, flooding the Android main thread with mounting exceptions.
- test: Compare exact build 761 against a build with the infinite FAB pulse removed; require no repeated `synchronouslyUpdateUIProps` failures while the home screen is idle.
- expecting: Build 761 produces an exception storm; the fixed build remains responsive without stale Fabric tag updates.
- next_action: Run the complete lint, typecheck, test, and AI-review gates before opening the pull request and activating the VPS responders.
- reasoning_checkpoint: The exact release emitted 5,965 `synchronouslyUpdateUIProps failed` warnings in roughly four seconds on the main thread. The stack repeatedly crosses Reanimated, React Native Fabric, and react-native-svg.
- tdd_checkpoint: Regression coverage now asserts that the draggable FAB no longer exposes or starts the continuous scale animation. Sentry configuration, PostHog uploads, prompt isolation, deduplication, and Sentry polling have success/failure tests.

## Evidence

- timestamp: 2026-08-04T17:24:46Z
  observation: The supplied screenshot shows a fully rendered Ogabassey home screen dimmed behind Android's "isn't responding" system dialog.
  implication: The app reached the home UI before the watchdog fired; prioritize post-render main-thread stalls and native ANR telemetry.
- timestamp: 2026-08-04T15:45:25Z
  observation: PostHog recorded app install/open for build 761 on a physical Samsung Galaxy A06 (SM-A065F, Android 14), followed only by a background event at 15:46:50Z. No screen, exception, or recovery event followed.
  implication: This is a strong match for the supplied 4:44 Lagos screenshot and demonstrates a native measurement gap rather than a captured JavaScript crash.
- timestamp: 2026-08-04T23:45:54Z
  observation: The exact CI artifact from release run 30803006711 was installed on the supported emulator and emitted 5,965 Reanimated `synchronouslyUpdateUIProps failed` warnings with stale Fabric surface tags in about four seconds.
  implication: The production binary has a reproducible main-thread exception storm in the rendered home UI; the continuously pulsing SVG-containing chat FAB is the persistent animation active in that state.
- timestamp: 2026-08-04T23:30:00Z
  observation: Every PostHog Android upload task was explicitly disabled in the generated Gradle project. Sentry was provisioned but the mobile SDK was absent. The VPS cron rewrote the same 19 prompt files every 15 minutes and autofix was disabled.
  implication: Native ANRs were not observable and the existing automation neither woke Codex nor deduplicated incidents.
- timestamp: 2026-08-04T23:38:00Z
  observation: The fixed debug APK built successfully through the repository-supported Android path, installed and launched on the supported emulator, remained the resumed activity, and produced zero `synchronouslyUpdateUIProps failed`, stale `SurfaceMountingManager`, ANR, or fatal-exception markers after the home bundle rendered.
  implication: Removing the continuous animated SVG boundary eliminates the exact failure storm reproduced from build 761 while preserving a live home screen.

## Eliminated

- Vercel/Supabase outage as the direct cause: no correlated server error appeared in the incident window, and neither provider can capture an Android main-thread stack.
- JavaScript exception as the direct signal: the matching session has no `$exception`, and the exact artifact remains alive while the native UI thread is flooded.

## Resolution

- root_cause: The leading hypothesis is that infinite Reanimated scale updates around the ChatWidget FAB targeted Fabric view tags after their SurfaceMountingManager was removed, producing an unbounded main-thread exception/logging loop. The fixed build also removed an unproven release-only Worklets bundle mode, so the FAB pulse has not been isolated as the sole cause with that setting held constant. Native ANR capture and source-map uploads were disabled or absent, hiding the failure.
- fix: Remove the infinite FAB pulse and animated SVG wrapper; remove the release-only Worklets opt-in; add early native Sentry ANR/crash initialization and release uploads; re-enable PostHog Android uploads; poll Sentry from the VPS with deduplicated, sandboxed, secret-isolated draft-PR automation and no auto-merge.
- verification: Focused mobile tests 77/77 and the earlier typecheck pass; build 761 reproduces 5,965/5,958 Reanimated/Fabric failures, while the fixed supported emulator build produces 0/0 and remains resumed. Full repository gates remain.
- files_changed: Mobile chat FAB, Expo/Sentry/Metro/Gradle/release workflow, PostHog upload plugin, VPS remediation workers/policy/state/docs/tests.
