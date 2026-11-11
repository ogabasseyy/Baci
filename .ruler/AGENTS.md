# Baci — AI-Native E-commerce Builder

**Baci** enables merchants to create complete e-commerce stores in minutes using Google Gemini for logo analysis, product descriptions, and store auto-configuration.

## Authorized use of repository material

Baci repository material is for work authorized by Baci's owner or maintainers. Agents may inspect, modify, test, and reference it to perform those tasks, including explicitly authorized or configured code review. Do not reuse, repurpose, publish, or distribute repository material for another project or outside an authorized task. Do not disclose secrets or private data. Third-party components remain subject to their own licenses, and applicable platform terms and legal rights continue to apply.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.2.9 (App Router) |
| Language | TypeScript 6.0.3 (strict mode) |
| UI | React 19 + shadcn/ui + Radix UI |
| Styling | Tailwind CSS 4.x (v4.3.0) |
| Database | Supabase (PostgreSQL with RLS) |
| Auth | Supabase Auth |
| State | React Context + Zustand |
| Forms | React Hook Form + Zod |
| AI | Google Gemini (2.0 Flash, 2.5 Flash Image, Imagen 3) |
| Payments | Korapay, Paystack, Kuda, Credit Direct |
| Email | ZeptoMail + React Email |
| Shipping | GIGL, Topship, Shiip |
| Linting | Biome (NOT ESLint) |
| Monorepo | pnpm + Turborepo |

## Monorepo Structure

```
Baci-app/
├── apps/
│   ├── web/                    # Next.js 16 (builder + storefronts)
│   │   └── src/
│   │       ├── app/            # App Router (pages + API routes, 40+ endpoints)
│   │       ├── ai/             # Google Gemini AI flows
│   │       ├── components/     # React components (ui/, themed/, storefront/, builder/, dashboard/)
│   │       ├── contexts/       # React Context providers
│   │       ├── hooks/          # Custom hooks
│   │       ├── lib/            # Utilities (supabase/, shipping/, sanitize*)
│   │       ├── store/          # Zustand stores
│   │       ├── types/          # TypeScript types
│   │       ├── schemas/        # Zod validation schemas
│   │       └── config/         # App configuration
│   ├── mobile-admin/           # Expo admin app
│   └── mobile-storefront/      # Expo customer storefront app
├── packages/
│   └── shared/                 # Shared schemas, types, utilities
└── supabase/
    └── migrations/             # Database migrations (90+ files, append-only)
```

## Commands

```bash
pnpm turbo dev        # Start dev server
pnpm turbo build      # Production build
pnpm turbo lint       # Biome linting
pnpm format           # Code formatting
pnpm turbo typecheck  # TypeScript check
pnpm turbo test       # Run tests (Vitest for web/mobile-admin, Jest for mobile-storefront)
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

## Deployment

- Hosted on **Vercel**; production deploys use a local/prebuilt CI build and must finish with `vercel deploy --prebuilt --prod`. The default runner is the VPS prebuilt flow on `bassey@82.29.190.219`; owner-approved emergency fallback may use a GitHub-hosted runner for the same prebuilt flow.
- Cron jobs in `vercel.json`
- Database on Supabase (always-on PostgreSQL)

## Pull Request Workflow (review-first CI)

Owner decision 2026-11-11: the expensive CI no longer starts on every push. For a pull request from this repository, CI runs in two passes (details and switch: `docs/runbooks/review-first-ci.md`).

- **Push, then wait.** Every push runs only the quick checks (change detection, lint, typecheck, misc guards, mobile guardrails, silent-revert guard) and `Semgrep SAST`. `Build` and `Quality Gate` do not exist yet: the PR shows them as "Expected - waiting", and the jobs that would carry those names are skipped under the name "(deferred until Codex review)". Merge and auto-merge stay blocked.
- **Codex starts the full CI.** Codex reviews each push. When it reports no major findings for the exact head commit, the `Review-first CI nudge` workflow re-runs the PR's CI run and the full suite (web test shards, mobile and shared tests, `Build`, DB replay, SQL suites, CWV contracts, checkout browser regression) starts by itself. Do not start CI by hand and do not re-run jobs to "get CI going".
- **Findings:** fix them and push; a new head commit needs a new Codex pass. Resolving a thread is not a clean verdict.
- **Break-glass, only when needed:** if Codex is down, rate limited or hung, or you have answered a finding with a recorded reason and no further pass will come, add the label `ci-now` (or comment `/ci-now`) and say why in the pull request. The label stays until removed, so every later push runs the full CI at once: remove it when Codex is back. With no Codex verdict at all for 60 minutes the full CI starts anyway (a warning shows on the `changes` job; a draft's 60 minutes start when it is marked ready).
- **Syncing with `main`** keeps Codex's verdict only when the PR's own diff is byte-identical; otherwise wait for a fresh Codex pass.
- **Never arm auto-merge (or merge) before Codex is clean on the final head.** The required checks only appear once the full CI starts, but a `ci-now` or timeout run can make them green without a Codex verdict.
- Switch: repository variable `BACI_REVIEW_FIRST_CI` (`on`; `pilot` = only PRs labelled `review-first-ci`; unset = the old behaviour, full CI on every push).
