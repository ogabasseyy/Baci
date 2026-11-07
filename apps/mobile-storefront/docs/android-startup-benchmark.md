# Android startup benchmark

The storefront Android release uses the GitHub Actions release workflow, Expo prebuild and Gradle. The iOS release uses Fastlane. EAS is optional and its environment is not the source of the Android workflow's GitHub secrets.

Keep the authoritative values in the team's password manager. Export a private local copy to `~/.config/baci/mobile-storefront-build.json` (or use an absolute path to a private JSON or dotenv file) and set its permissions to `600`. Never commit that export or copy it into the repository. A missing public client key does not require generating a replacement; token rotation is a deliberate separate operation.

The profile must contain the existing production values for `STOREFRONT_FACEBOOK_APP_ID`, `STOREFRONT_FACEBOOK_CLIENT_TOKEN`, `EXPO_PUBLIC_POSTHOG_API_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `EXPO_PUBLIC_SUPABASE_URL`, and one of `EXPO_PUBLIC_SUPABASE_ANON_KEY` or `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Include the existing production client feature flags and IDs where enabled, plus API URL and other needed client settings. Values already present in the process environment override the private file. Unknown profile keys are not passed to the build.

From `apps/mobile-storefront`, run `pnpm android:benchmark --check` to validate the default profile without building or network access. Use `pnpm android:benchmark --check --env-file /absolute/path/to/profile` to select another private file. The preflight reports missing names, not values.

After the check succeeds, `pnpm android:benchmark` updates the Android project incrementally (`expo prebuild --no-clean`) and builds a release-mode, ARM64 APK with R8 and resource shrinking. Gradle is capped at two workers with a 4 GiB Java heap, matching the release workflow; Metro is also capped at two workers, and the Gradle JVM reports two processors so internal compiler pools also respect the local CPU limit. By default it uses a temporary Gradle init script to apply a `.benchmark` application ID suffix and debug signing. The existing Firebase configuration must already have a matching `.benchmark` Android client; the launcher checks this before building and does not register one. It neither installs nor launches the APK. The command prints its output path. It disables Sentry uploads with the installed plugin's environment flags, and disables PostHog upload tasks using the temporary init script because the installed PostHog Gradle integration exposes no equivalent opt-out. This avoids publishing symbols or uploading a build. The local build can still fetch build dependencies when not already cached.

The JavaScript bundle is production-optimized while the local profile uses the preview app environment and the `benchmark` Sentry environment. If a build step fails, the command records redacted output in a private local diagnostics directory and prints its path. Use a checkout without a worktree-local `.env`, which app config otherwise loads outside the benchmark allowlist.

The APK uses real production client settings and can contact production services. Measure startup without creating orders or other live transactions. A benchmark APK is not store-signed or publishable, and its timings do not establish performance of an installed store release; compare against a real release artifact as well.

If Firebase has only the existing application package, `pnpm android:benchmark --use-installed-debug-package` explicitly builds with that package and debug signing. Before manually installing, verify the new APK and installed debug app have matching signing certificate digests. Do not uninstall the app or clear its data. This mode updates the existing app if installed, so its startup measurements include its existing data.

For an explicitly authorized Sentry receipt check, set `EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID` in the build process environment to a unique, non-identifying label containing only letters, numbers, underscores, or hyphens. The benchmark app sends one non-crashing info-level event after splash handoff, tagged with that label and `verification_kind=startup_receipt`. A local marker records only the attempt and suppresses repeat sends for the same label on subsequent launches. A successful SDK flush is not proof of receipt; verify the tag in the configured Sentry project. Ordinary builds without the opt-in and builds outside the benchmark Sentry environment send nothing.

Benchmark JS is rebuilt with Metro's cache reset on each invocation. React
Native's Gradle bundle task does not declare environment-only client settings as
inputs, so leaving that task up-to-date can silently package the previous JS.
Only the JS bundle task bypasses the up-to-date check; native compilation keeps
its normal cache. A small Gradle regression fixture exercises this behavior when
the wrapper's Gradle distribution is already cached, without downloading one.
