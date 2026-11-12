# Gemini Review Guidance

## Draft-first pull requests

Owner decision, 2026-11-12: agents must create pull requests as drafts (`gh pr create --draft`). Keep fixes and review rounds in draft. For same-repository drafts, Codex and Muse automatically review new pushes; reuse current-head reviews or in-flight requests rather than posting duplicate requests.

Before running `gh pr ready <pr>`, verify that **both Codex and Muse** have completed a clean general code review for the exact current `headRefOid`, with no unresolved actionable findings or later contradictory review metadata. Verify reviewer identity and reviewed SHA; a green workflow alone, skipped/failed review, quota message, resolved old thread, or older-head verdict is not a clean review. Fix findings and push while still in draft, then wait for both reviewers again. If either reviewer is unavailable, keep the PR draft and report the blocker; only an explicit owner exception may waive this readiness rule.

If another code change or base sync is needed after marking ready, convert back to draft (`gh pr ready <pr> --undo`) **before pushing**, so both draft reviewers run again. Recheck both reviewers on the new head. Keep explicitly paused or deprioritized PRs draft until the owner resumes them, even when reviews are clean.

“Ready” means ready for review and required CI, not permission to merge. Merge only when authorized by the user, both reviewers are clean on the final head, all required checks pass, and actionable conversations are resolved. Until a required GitHub check enforces both reviews on the exact head, do not arm auto-merge; disable any existing auto-merge (`gh pr merge <pr> --disable-auto`) before changing the PR, and use `gh pr merge <pr> --squash --match-head-commit <reviewed-sha>` for an authorized merge to reject a changed head. This is an agent policy: Muse is not currently a required GitHub status check. The review-first CI scheduler still uses Codex alone and can start heavy CI while a PR is draft; this rule does not change that scheduler or waive either review when `ci-now` or the timeout starts CI.

This file gives Gemini the repository constraints it must follow when reviewing pull requests in Baci.

## Authorized use of repository material

Use Baci repository material only for work authorized by Baci's owner or maintainers, including explicitly authorized or configured code review. Do not reuse, repurpose, publish, or distribute it for another project or outside an authorized task. Protect secrets and private data. Third-party licenses, applicable platform terms, and legal rights continue to apply.

## Review focus

- Prioritize correctness, regressions, security, data safety, and missing tests.
- Prefer a small number of high-signal findings over broad style commentary.
- Call out behavior changes and production risk clearly.

## Repository rules

- This is a pnpm monorepo. Use `pnpm` and `pnpm turbo` only.
- Biome is the linter and formatter. Do not introduce ESLint.
- React Compiler is enabled. Do not suggest `React.memo`, `useMemo`, or `useCallback` by default.
- Do not modify `proxy.ts` or `src/config/business-types.ts` without explicit approval.
- Existing `supabase/migrations/` files are append-only.
- Avoid `any`; prefer explicit types or `unknown`.
- Validate API inputs with Zod and keep protected routes auth-first.
- Do not use `select('*')` in Supabase queries.
- For `apps/mobile-admin` Android emulator QA, start only with `pnpm --filter baci-mobile-admin android:emulator`; this is the only supported emulator launch path for agents and automation. Do not launch the emulator directly or with `-gpu swiftshader_indirect`. The default launcher AVD is `Baci_Pixel_9_Pro_XL_API_36_Google`, an Android 16 API 36 Google APIs Pixel 9 Pro XL profile with `auto` GPU, 2 CPU cores, and 4096 MB RAM.
- For `apps/mobile-admin` Android debug APK install QA, build with `cd apps/mobile-admin/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain`, then install with `pnpm --filter baci-mobile-admin android:install`; do not use Gradle `installDebug` for emulator QA on this host.
- For `apps/mobile-admin` Android Metro QA, start only with `pnpm --filter baci-mobile-admin android:metro`; do not use a localhost-only Metro host for emulator QA because the dev client connects through `10.0.2.2`.
- For `apps/mobile-admin` Android dev-client launch QA, start only with `pnpm --filter baci-mobile-admin android:launch`; do not use raw `adb shell am start` commands because the repo launcher owns the Metro reverse, settled-load check, package force-stop, and Expo dev-client URL.

## Architecture notes

- `apps/web/` is the Next.js 16 app for the builder and storefronts.
- `apps/mobile-admin/` and `apps/mobile-storefront/` are Expo apps.
- Shared logic belongs in `packages/shared/` when multiple apps depend on it.
- Storefront theming should rely on CSS variables and existing themed components.

## Risk hotspots

- Payments and webhook handlers need extra scrutiny.
- Multi-tenant routing, auth, and domain logic are sensitive.
- Storefront performance matters. Flag avoidable client-side bloat or heavy dependencies.

## Review style

- Keep comments concise and actionable.
- Mention missing regression tests when a bug fix changes runtime behavior.
- Prefer concrete file and behavior references over generic advice.
