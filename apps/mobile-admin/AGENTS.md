# Mobile Admin Guardrails

## Platform Drift

- Prefer shared primitives over inline platform branches.
- Android emulator QA must start from `pnpm --filter baci-mobile-admin android:emulator`. This is the only supported emulator launch path for agents and automation. Do not launch the emulator directly or with `-gpu swiftshader_indirect`; the script owns GPU mode, Quick Boot, ADB reset, boot waiting, Android settle checks, the Metro ADB reverse, and ADB shell validation.
- The default Android QA AVD is `Baci_Pixel_9_Pro_XL_API_36_Google`, an Android 16 API 36 Google APIs arm64 image using the Pixel 9 Pro XL profile, emulator GPU mode `auto`, 2 CPU cores, and 4096 MB RAM. API 36 ATD images are not exposed by this host's command-line SDK catalog, and API 36.1 Google APIs hung during install verification, so do not downgrade the default to API 35 ATD or switch to API 36.1 without a passing scripted launch and install smoke. Use `BACI_ANDROID_AVD_NAME` only for explicit emulator-infrastructure fallback triage.
- Android debug APK install QA must use `pnpm --filter baci-mobile-admin android:install` after `cd apps/mobile-admin/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain` from the repo root, or `cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain` from `apps/mobile-admin`. Do not use Gradle `installDebug` for emulator QA on this host; the repo installer uses non-streaming ADB install to avoid ddmlib property-fetch timeouts on Android 16.
- Android Metro QA must use `pnpm --filter baci-mobile-admin android:metro`. Do not use a localhost-only Metro host for emulator QA because the dev client connects through `10.0.2.2`.
- Android dev-client launch QA must use `pnpm --filter baci-mobile-admin android:launch`. Do not use raw `adb shell am start` commands because the script owns the Metro reverse, settled-load check, package force-stop, and Expo dev-client URL.
- Add new modal, sheet, picker, or keyboard behavior through shared UI helpers in `components/ui/` whenever possible.
- Treat new `Platform.OS` and `Platform.select` usage as exceptional, not normal.
- If a new platform-specific branch is unavoidable:
  - keep the divergence local and documented with a short comment
  - update `config/platform-branch-allowlist.json`
  - run `pnpm check:platform-drift`
- Do not disable Android keyboard avoidance with an iOS-only `KeyboardAvoidingView` behavior.
- If a simulator or emulator keyboard does not appear but `TextInput` focus still works, treat that as an environment/config issue first before changing app code.
- Any bug caused by iOS/Android drift must include either:
  - a regression test, or
  - a shared abstraction change that prevents the same class of bug elsewhere.

## Preferred Shared Primitives

- `components/ui/CountryPickerModal.tsx`
- `components/ui/AppDatePickerField.tsx`
- `components/ui/AppKeyboardContainer.tsx`
- `components/ui/ReceiptPreviewModal.tsx`
- `components/ui/StatusModal.tsx`
- `components/ui/SuccessModal.tsx`

Before creating a new cross-platform interaction pattern, extend an existing primitive first if it can support the use case cleanly.

## Intentional Native Seams

These are the only categories where direct platform branching is expected:

- Auth providers: Apple/Google sign-in handshakes and native capability checks.
- Notifications: push token registration, channel setup, and delivery permissions.
- Subscriptions and RevenueCat: store-management deep links and native entitlement surfaces.
- Native export/share: OS-level share sheets and export module loading.
- iOS action sheets: platform-consistent option menus for destructive/choice flows.
- Android hardware back: explicit back-handler behavior in modal/detail contexts.
- Platform telemetry: analytics/reporting hooks that need native OS labels.

## Tests

- Plain `.ts` tests run in Node and `.tsx` tests run in jsdom (see `vitest.config.ts`). A `.ts` test that needs `window` or `document`, for example one that calls `renderHook`, must start with `// @vitest-environment jsdom`; without it the test fails with a ReferenceError.
