# Lane 3 source handoff, 2 October 2026

Canonical checkout: `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
All lane edits are in this checkout. Receiving replay worktree was not edited.

## Concrete fixes

- `apps/mobile-storefront/app.config.ts` now returns the validated development
  manifest before loading production validation. It remains 20 lines. Dotenv
  remains in this root wrapper, resolving `.env` from the app root.
- `apps/mobile-storefront/config/development-storefront-expo-config-production.ts`
  contains the unchanged production factory/validation, with module imports
  adjusted for its config-directory location. It is 288 lines. Native assets,
  Google services paths, plugins, Facebook/PostHog/Sentry requirements, native
  identity and updates remain equivalent to the previous root config.
- `apps/mobile-storefront/config/development-storefront-expo-config.js` explicitly
  includes `expo-dev-client` alongside notifications only with staging capability.
  Missing native pins fail closed in the staging EAS profile. Missing/off hosted
  flags also refuse that profile rather than falling through to production.
- `apps/mobile-storefront/config/hosted-staging-push-capability.js` now supplies
  one strict native validator to local hosted config, cloud preparation and
  installed-manifest preflight. Format, 255-character limits, exact field sets,
  production IDs and exact origins cannot drift between those entry points.
  The preflight validates raw capability fields rather than silently stripping
  unknown fields, and cannot report ready without installed identity/platform.
- `tools/staging/mobile-push/resolve-config.mjs` resolves the actual root source
  offline with copied environment and candidate pins. It never loads real dotenv
  credentials. `preflight.mjs` validates the resulting identity/plugins and emits
  only a manifest hash, booleans and fixed categories, never manifest keys.
- `tools/staging/mobile-push/acceptance.mjs` and `acceptance.template.json` provide
  a disabled, offline evidence pipeline. They require approved authenticated
  project/signing inventory, matching build/config/artifact identities, actual
  physical-device permission/registration, foreground/background/cold-start
  receipt, matching goal and scoped wallet query refresh, genuine paid-net
  interest wording/refresh/duplicate safety, and isolated nonprovider preview.
  Complete input evidence still cannot claim independently verified device,
  provider payout or build authorization. Parent review remains mandatory.
- The acceptance evidence schema lives in
  `tools/staging/mobile-push/schemas/acceptance.mjs`, with colocated schema tests.
  The harness imports the strict schema; report behavior and guards are unchanged.
  Build metadata now includes its platform, and acceptance requires it to match
  the installed physical device's platform before accepting its build ID.
- `tools/staging/mobile-push/README.md` contains the exact validation and
  acceptance commands plus the isolated native-generation handoff. No EAS
  profile, real identity, push token, signing file or env file was fabricated.

Colocated regressions are in `config/hosted-staging-push-app-config.test.mjs`,
`config/development-storefront-expo-config-production.test.mjs`, and the
`tools/staging/mobile-push/{preflight,resolve-config,acceptance}.test.mjs` files.
Schema boundary regressions are in
`tools/staging/mobile-push/schemas/acceptance.test.mjs`.
Existing unrelated dirty files and platform-branch allowlist were preserved.

## Validation and artifacts

- Regression first reproduced the actual full root config failure on missing
  production Facebook credentials in a clean reviewed staging EAS environment.
- Initial full offline suite: 49 passed, zero failed. Artifact:
  `/private/tmp/baci-lane3-20261002/source-tests.log`.
- After schema extraction, all 26 focused schema, acceptance, preflight and
  resolver tests pass. Eight schema tests cover valid/null evidence, extra and
  missing fields, metadata/fingerprint boundaries, booleans and every protected
  literal. No EAS command/build or real dotenv load was used in this follow-up.
- After reviewing CodeRabbit findings, the full focused suite has 66 passing
  tests, zero failures. Artifact:
  `/private/tmp/baci-lane3-20261002/review-regressions.log`. New regressions cover
  inconsistent native validation across all three entry points, explicit staging
  profile without an EAS marker, absent installed identity, cross-platform build
  evidence, and source resolution through a path containing spaces/percent signs.
  All four production manifest/dotenv comparisons were repeated successfully.
- Final config/harness glob, including the colocated acceptance schema suite:
  59 tests pass, zero failures. This is the same scope independently rerun by
  parent; the earlier 66-test run additionally includes seven development-config
  tests. Final glob artifact:
  `/private/tmp/baci-lane3-20261002/final-harness.log`.
- Final scoped Biome checks 23 files with zero errors or fixes; whitespace diff
  checks pass. No outstanding lane regression or review fix remains.
- Existing focused mobile suite: 84 passed across 11 suites, including scoped
  wallet cache invalidation, tenant notification events, push registration/taps,
  inbox, native capability and visibly labelled simulated interest preview.
  Artifact: `/private/tmp/baci-lane3-20261002/mobile-tests.log`.
- Full production manifests were compared to the pre-edit source across
  production, CI, EAS with explicit version overrides, and test environments:
  all four matched, including root dotenv resolution. Captured pre-edit source:
  `/private/tmp/baci-lane3-20261002/original-app.config.ts`.
- Scoped Biome and whitespace diff checks pass. Source modules stay under 300
  lines. Repository-wide `pnpm turbo lint` fails on existing mobile diagnostics
  (11 errors); `pnpm turbo typecheck` reports unrelated checkout test typing
  errors plus ENOSPC while flushing logs. Artifacts:
  `/private/tmp/baci-lane3-20261002/lint.log` and
  `/private/tmp/baci-lane3-20261002/typecheck.log`. No clean global gate claimed.
- Earlier post-review global lint/typecheck reruns failed on the same existing
  11 mobile lint errors and three checkout-test typing errors, respectively;
  no lane source diagnostics were reported. Earlier rerun artifacts:
  `/private/tmp/baci-lane3-20261002/review-lint.log` and
  `/private/tmp/baci-lane3-20261002/review-typecheck.log`.
  Parent owns the fresh canonical global checks now running; this final lane
  verification does not duplicate them or claim their result.

Source SHA-256, rechecked against current files at the final lane handoff:

| File | SHA-256 |
| --- | --- |
| app.config.ts | 8c3afca0cef84873a3d2d8722c8c5c7e67b45dc8c70433cf1e1998e362a62b93 |
| config/development-storefront-expo-config-production.ts | ad159a56efca806f0cbf9cca5645ca61d1e6ee5341913b4d80925411d58e703f |
| config/development-storefront-expo-config.js | 86b109639a402ff3c6fb0a587cd2a410251621fc4234fd6e3f018b4fee3f7ed0 |
| config/hosted-staging-push-capability.js | 13462e8fb3f470ce18c3dc7d0bc0736b9c1e4e423dec5bd5dd8e5ded4d507f3f |
| config/hosted-staging-push-build.js | 3c1aa7799587a58705454222ea5319d175b47e0653536453b24d4c0a47b098a3 |
| config/hosted-staging-push-preflight.mjs | 2d749bc14fbafcd347fa625c386737f3409d6424c877a0ad25ff685ee7e16b7b |
| tools/staging/mobile-push/preflight.mjs | 78ac1830a9afd8fbb5f1fe270464b1bfc8d92091758e092e1059f9b4d6bc8706 |
| tools/staging/mobile-push/acceptance.mjs | 48a412c2c2738d42b9e7f5fc4871c47426d11ed16762d023170e5690a2d78538 |
| tools/staging/mobile-push/schemas/acceptance.mjs | 85bb52f62a2d54574a3e13cf75858e7f6e46904c96ed272195e8854ae735e21b |
| tools/staging/mobile-push/resolve-config.mjs | b49e8967fc105d378d52fccce6c5bb7d3ed7a278244ef9a3bc5e7230b7d6abbd |

These are source hashes, not native build, signing or push-delivery evidence.

## Scoped review dispositions

The valid native-validation, EAS-marker, installed-identity, build-platform and
file-URL findings are fixed with regressions. The production test and resolver
use `fileURLToPath`; test CLI launches were updated too. Generic README commands
now refer to the repository root.

The comment-only request is declined because this lane forbids inline comments.
README explains why normalized staging copies retain the profile, continue in
the same builder invocation and cannot be reused as a new external launch.
Machine-local paths in this operational handoff are retained because the owner
requested exact checkout/artifact locations. They are temporary local evidence,
not durable publication links or proof of deployment. No artifact durability is
claimed. No extra CodeRabbit agent was started; parent owns the follow-up review.
All valid scoped findings are resolved. The two retained dispositions above
cover the prohibited inline-comment request and required operational paths.

## Unavoidable remaining gates

Installed EAS CLI read-only `whoami` returns `Not logged in` (exit 1).
No authenticated staging inventory can be established. The CI-wrapped pnpm
probe instead encountered an automatic package-manager shim installation attempt
that failed ENOSPC; the already installed global EAS CLI confirmed signed-out
status without that wrapper. No paid build or project creation was requested.

Read-only `devicectl` reports one paired phone, disconnected, with local-network
transport. Metadata artifact:
`/private/tmp/baci-lane3-20261002/device-inventory.json`.
No installation, permission reset, token registration or push send was performed.
Current canonical native staging pins remain absent; default preflight and
acceptance both exit 1. Approved staging project/native IDs, signing/FCM/APNs,
actual EAS resolved environment, isolated generated native build and a connected
physical phone remain parent-owned gates.
EAS authentication, native pins and device state were not changed or re-probed
during the final source-only verification; parent confirms those gates unchanged.

Acceptance retains the fixed deadline `2026-10-06T15:59:10Z`, principal and total
approved prefunding of 10,000 kobo, financial replay/background/snapshot off,
and readonly checkout GET 200/false/max0 with POST/PATCH 503. Backend inbox/device
counts in the parent status file were read as context, not independently renewed
by this lane. No genuine interest payout, card payment or push success is claimed.
No live database/provider writes, deployment, root-console/browser access,
commits, branches, migration/proxy/env changes, or disk cleanup occurred here.
