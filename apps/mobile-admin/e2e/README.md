# Mobile-admin semantic E2E contract

This folder contains framework-neutral helpers for a future device runner. The
contract follows the useful part of the Shopify-derived stability practice:
resolve controls by exact semantics, assert readiness before and after each
action, and require three complete flow runs before calling a path stable.

`semantic-actions.ts` has no ADB calls, arbitrary sleeps, hidden retries, or
Detox/Maestro dependency. A runner must own its reset, accessibility-tree
capture, and app-log capture. On failure, preserve the iteration number,
accessibility tree, and app log; do not hide flakiness with a fixed delay.

## Supported Android setup

Run the checked-in sequence from the repository root:

```bash
pnpm --filter baci-mobile-admin android:emulator
cd apps/mobile-admin/android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
cd ../../..
pnpm --filter baci-mobile-admin android:install
pnpm --filter baci-mobile-admin android:metro
pnpm --filter baci-mobile-admin android:launch
```

Do not launch an AVD directly, use `-gpu swiftshader_indirect`, use a
localhost-only Metro host, or call `adb shell am start`. The repository
launchers own boot readiness, ADB stability, Metro reverse, and dev-client
startup.

## Current signed-out semantic surface

These labels are taken from the current mobile-admin source and are the
selectors a runner may use when the matching screen state is ready:

1. Login: `Email` (textbox), `Password` (textbox), `Sign in to your account`
   (button), and `Forgot password? Reset your password` (link). While a login
   is in flight the button intentionally becomes `Signing in` and disabled;
   assert the idle label before tapping it.
2. Verification: `Verify Email` (button), `Resend code` (button), and
   `Continue setup` (button only after a successful verification overlay).
   `Resend code` starts disabled while its countdown is active, so a runner
   must wait for the enabled semantic state rather than sleep.
3. Recovery: `Back to login` and `Send Instructions` are stable button labels.
   The email input currently exposes the `your@email.com` placeholder in
   tests but no explicit `accessibilityLabel` in app code. Do not promote that
   placeholder to a semantic contract; full recovery coverage is blocked until
   the input receives a stable accessibility label in app code.

For every covered flow, use `runSemanticStep` for before/action/after
assertions and `runWithStabilityGate` with its default three complete runs.
Authenticated merchant flows require approved test credentials and explicit
data-reset ownership before they are added.
