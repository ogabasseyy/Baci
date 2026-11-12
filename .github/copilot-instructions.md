# GitHub Copilot Instructions - Baci E-commerce Platform

## Draft-first pull requests

Owner decision, 2026-11-12: agents must create pull requests as drafts (`gh pr create --draft`). Keep fixes and review rounds in draft. For same-repository drafts, Codex and Muse automatically review new pushes; reuse current-head reviews or in-flight requests rather than posting duplicate requests.

Before running `gh pr ready <pr>`, verify that **both Codex and Muse** have completed a clean general code review for the exact current `headRefOid`, with no unresolved actionable findings or later contradictory review metadata. Verify reviewer identity and reviewed SHA; a green workflow alone, skipped/failed review, quota message, resolved old thread, or older-head verdict is not a clean review. Fix findings and push while still in draft, then wait for both reviewers again. If either reviewer is unavailable, keep the PR draft and report the blocker; only an explicit owner exception may waive this readiness rule.

If another code change or base sync is needed after marking ready, convert back to draft (`gh pr ready <pr> --undo`) **before pushing**, so both draft reviewers run again. Recheck both reviewers on the new head. Keep explicitly paused or deprioritized PRs draft until the owner resumes them, even when reviews are clean.

“Ready” means ready for review and required CI, not permission to merge. Merge only when authorized by the user, both reviewers are clean on the final head, all required checks pass, and actionable conversations are resolved. Until a required GitHub check enforces both reviews on the exact head, do not arm auto-merge; disable any existing auto-merge (`gh pr merge <pr> --disable-auto`) before changing the PR, and use `gh pr merge <pr> --squash --match-head-commit <reviewed-sha>` for an authorized merge to reject a changed head. This is an agent policy: Muse is not currently a required GitHub status check. The review-first CI scheduler still uses Codex alone and can start heavy CI while a PR is draft; this rule does not change that scheduler or waive either review when `ci-now` or the timeout starts CI.

## Authorized use of repository material

Use Baci repository material only for work authorized by Baci's owner or maintainers, including explicitly authorized or configured code review. Do not reuse, repurpose, publish, or distribute it for another project or outside an authorized task. Protect secrets and private data. Third-party licenses, applicable platform terms, and legal rights continue to apply.

## Critical Rules

- This is a **pnpm monorepo** with Turborepo. NEVER use npm or yarn.
- **Biome** for linting (NOT ESLint). Run `pnpm turbo lint`.
- **React Compiler** is enabled. NEVER add `React.memo`, `useCallback`, or `useMemo`.
- **Supabase** for database. Use correct client factories: `@/lib/supabase/server` (SSR), `@/lib/supabase/client` (browser), `@/lib/supabase/admin` (service role).
- NEVER edit existing migration files. Migrations are append-only.
- NEVER use `select('*')` — always select specific columns.
- ALWAYS validate API inputs with Zod before database operations.
- ALWAYS check auth as the first operation in protected API routes.

## Testing & Modularity Enforcement

### Mandatory Test Coverage

Every new or significantly modified file MUST have a colocated test file:

| Source File | Test File |
|-------------|-----------|
| `MyComponent.tsx` | `MyComponent.test.tsx` |
| `useMyHook.ts` | `useMyHook.test.ts` |
| `my-util.ts` | `my-util.test.ts` |
| `route.ts` (API) | `route.test.ts` |
| `my-schema.ts` (Zod) | `my-schema.test.ts` |

**Requires tests:** New components, hooks, utilities, API routes, Zod schemas, bug fixes.
**Exempt:** Type files, config constants, barrel re-exports, CSS, docs.

### Test Quality

- Vitest + React Testing Library
- AAA pattern: Arrange, Act, Assert
- Test both success AND error paths
- Use `screen.getByRole()` over `getByTestId()`
- No flaky tests

### Modularity

- One component, hook, or utility per file. Max 300 lines.
- Extract shared logic into `packages/shared/src/`.
- Move inline Zod schemas to `schemas/` directory.
- No God components — split if doing 3+ unrelated things.

## Project Structure

```
apps/web/src/          # Next.js 16 App Router
apps/mobile-admin/     # Expo admin app
apps/mobile-storefront/ # Expo customer app
packages/shared/       # Shared schemas, types, utilities
supabase/migrations/   # Database migrations (append-only)
```

## Commands

```bash
pnpm turbo dev        # Start dev server
pnpm turbo build      # Production build
pnpm turbo lint       # Biome linting
pnpm turbo typecheck  # TypeScript check
pnpm turbo test       # Run tests (Vitest)
```

## Android Emulator QA

For `apps/mobile-admin`, Android emulator QA must start from:

```bash
pnpm --filter baci-mobile-admin android:emulator
```

This is the only supported emulator launch path for agents and automation. Do not launch the emulator directly or with `-gpu swiftshader_indirect`; the repo launcher owns GPU mode, Quick Boot, ADB reset, boot waiting, Android settle checks, the Metro ADB reverse, and ADB shell stability checks.
The default launcher AVD is `Baci_Pixel_9_Pro_XL_API_36_Google`, an Android 16 API 36 Google APIs Pixel 9 Pro XL profile with `auto` GPU, 2 CPU cores, and 4096 MB RAM. Use `BACI_ANDROID_AVD_NAME` only for explicit emulator-infrastructure fallback triage.
Build with `cd apps/mobile-admin/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain`, then install with `pnpm --filter baci-mobile-admin android:install`; do not use Gradle `installDebug` for emulator QA on this host.
Run Metro for Android with `pnpm --filter baci-mobile-admin android:metro`; do not use a localhost-only Metro host for emulator QA because the dev client connects through `10.0.2.2`.
Launch the Android dev client with `pnpm --filter baci-mobile-admin android:launch`; do not use raw `adb shell am start` commands because the repo launcher owns the Metro reverse, settled-load check, package force-stop, and Expo dev-client URL.
