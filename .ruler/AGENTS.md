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

## Draft-first pull requests

<!-- draft-first-policy:start -->

Authoritative source: `.ruler/AGENTS.md`. Keep this marked policy block identical in all agent instructions and the runbook; `.github/scripts/review-first-ci/agent-policy.test.mjs` checks the copies in CI.

Owner decision, 2026-11-12: agents must create pull requests as drafts (`gh pr create --draft`). Keep fixes and review rounds in draft. For same-repository drafts, Codex and Muse automatically review new pushes; reuse current-head reviews or in-flight requests rather than posting duplicate requests.

Before running `gh pr ready <pr>`, verify that **both Codex and Muse** have completed a clean general code review for the exact current `headRefOid`, with no unresolved actionable findings or later contradictory review metadata. Verify reviewer identity and reviewed SHA; a green workflow alone, skipped/failed review, quota message, resolved old thread, or older-head verdict is not a clean review. Fix findings and push while still in draft, then wait for both reviewers again. If either reviewer is unavailable, keep the PR draft and report the blocker; only an explicit owner exception may waive this readiness rule.

Record the reviewed base branch and base commit as well as the head. A base retarget can change the diff without changing `headRefOid`: return to draft and explicitly request a fresh `@codex review` after retargeting (the draft Codex workflow does not automatically handle base edits). Wait for a new Codex receipt after that request and a fresh Muse review for the new base; do not reuse a same-head receipt from the old base. Any base identity change invalidates readiness evidence. Pin Muse provenance, head/base identity and clean wording using the “What counts as Muse is clean” checklist in `docs/runbooks/review-first-ci.md`.

Fork PRs follow the same review requirements, but these secret-bearing automatic reviewers do not run on forks. Report that limitation promptly and keep the PR draft while the owner arranges a trusted same-repository review branch or records a specific reviewer exception. If draft conversion is unavailable, report it promptly, keep auto-merge disabled and do not merge or claim review readiness; request an owner-approved review path. Reviewer outages follow the same escalation path. Never silently waive a reviewer, wait indefinitely without reporting the blocker, or expose secrets to fork code.

If another code change or base sync is needed after marking ready, convert back to draft (`gh pr ready <pr> --undo`) **before pushing**, so both draft reviewers run again. Recheck both reviewers on the new head. Keep explicitly paused or deprioritized PRs draft until the owner resumes them, even when reviews are clean.

“Ready” means ready for review and required CI, not permission to merge. Merge only when authorized by the user, both reviewers are clean on the final head, all required checks pass, and actionable conversations are resolved. Until a required GitHub check enforces both reviews on the exact head, do not arm auto-merge; disable any existing auto-merge (`gh pr merge <pr> --disable-auto`) before changing the PR, and use `gh pr merge <pr> --squash --match-head-commit <reviewed-sha>` for an authorized merge to reject a changed head. This is an agent policy: Muse is not currently a required GitHub status check. For same-repository PRs selected by review-first CI (`on`, or `pilot` with the `review-first-ci` label), drafts run AI reviews and essential workflow safeguards only, even when Codex is clean or `ci-now` is present. Lint, typecheck, application tests, miscellaneous tests, mobile guardrails and builds wait for the full stage. Semgrep also waits until ready; secret scanning remains active. Fork PRs and PRs outside that selection retain their existing main-CI behavior, including while draft (Semgrep draft deferral applies independently); the agent draft/readiness policy still applies to them. Marking ready releases validation through the existing Codex gate; the helper repeats only the small safeguards because validation has not run during draft review; agents must verify both reviewers first. Muse remains an agent readiness requirement, not a machine-enforced verdict gate. On ready PRs, `ci-now` and timeout recovery do not waive either review before merging.

<!-- draft-first-policy:end -->

## Pull Request Workflow (review-first CI)

Owner decision 2026-11-11: the expensive CI no longer starts on every push. For a pull request from this repository, CI runs in two passes (details and switch: `docs/runbooks/review-first-ci.md`).

- **Push, then wait.** For selected same-repository PRs, the first pass runs only change detection, capability/workflow safeguards, the silent-revert guard and secret scanning. Lint, typecheck, tests, mobile guardrails, builds and Semgrep are deferred until ready. `Build` and `Quality Gate` do not exist yet: the PR shows them as "Expected - waiting", and the jobs that would carry those names are skipped under the name "(deferred until Codex review)". Merge stays blocked. Selected drafts remain in this safeguards-only stage regardless of Codex status or `ci-now`; forks and unselected PRs retain their main-CI behavior; Semgrep defers on all draft PRs.
- **Codex starts the full CI.** Codex reviews each push. Once the PR is marked ready and Codex reports no major findings for the exact head commit, the `Review-first CI nudge` workflow re-runs the PR's CI run and the full suite (lint, typecheck, miscellaneous tests, mobile guardrails, web test shards, mobile and shared tests, `Build`, DB replay, SQL suites, CWV contracts, checkout browser regression) starts by itself. Do not start CI by hand and do not re-run jobs to "get CI going".
- **Findings:** fix them and push; a new head commit needs a new Codex pass. Resolving a thread is not a clean verdict.
- **Break-glass, only when needed:** if Codex is down, rate limited or hung, or you have answered a finding with a recorded reason and no further pass will come, add the label `ci-now` (or comment `/ci-now`) and say why in the pull request. For selected ready PRs, the label stays until removed, so every later ready-PR push runs full CI at once: remove it when Codex is back. Selected drafts stay safeguards-only even with this label. With no Codex verdict at all for 30 minutes on a selected ready PR, full CI starts anyway, so nobody waits forever (a warning shows on the `changes` job; a draft's 30 minutes start when it is marked ready; the value is `DEFAULT_TIMEOUT_MINUTES` in `.github/scripts/review-first-ci/stage-decision.mjs`, overridable with the repository variable `BACI_CODEX_WAIT_TIMEOUT_MINUTES`).
- **Syncing with `main`** keeps Codex's verdict only when the PR's own diff is byte-identical; otherwise wait for a fresh Codex pass.
- **Never arm auto-merge (or merge) before Codex is clean on the final head.** The required checks only appear once the full CI starts, but a `ci-now` or timeout run can make them green without a Codex verdict.
- Switch: repository variable `BACI_REVIEW_FIRST_CI` (`on`; `pilot` = only PRs labelled `review-first-ci`; unset = the old behaviour, full CI on every push).
