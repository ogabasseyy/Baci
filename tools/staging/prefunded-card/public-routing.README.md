# First-card public routing candidate

This is an offline candidate renderer. It never installs files, contacts a
service, reloads Nginx, changes a Vercel project, or enables checkout. Start
from owner-captured Vercel Build Output `config.json` and the complete existing
`staging-auth.ogabassey.com` Nginx server configuration. Supply each file's
SHA-256 explicitly; a changed baseline, ambiguous server/upstream, or existing
route collision is refused.

Run from the repository root after the runtime and private end-to-end readiness
report exists:

```sh
pnpm --filter @baci/web exec tsx ../../tools/staging/prefunded-card/public-routing-cli.ts \
  --vercel-baseline /reviewed/path/config.json --vercel-sha256 <sha256> \
  --nginx-baseline /reviewed/path/staging-auth.conf --nginx-sha256 <sha256> \
  --readiness /reviewed/path/runtime-readiness.json --readiness-sha256 <sha256> \
  --out-dir /reviewed/path/public-routing-candidate
```

The readiness report must contain exactly version `1`, database system ID,
`issuedAt`, `expiresAt`, and `checks`; check names and boolean values must be
exact. `issuedAt` must be within 15 minutes of the renderer's current clock.
The report uses database system ID
`7685292944002592802`, deadline `2026-09-29T15:59:10Z`, and true checks for
`rootPrerequisites`, `checkoutStorage`, `treasuryBinding`, `providerCollection`,
`providerSettlement`, `webhookRecovery`, `backgroundRecovery`, `appArtifact`,
and `privateEndToEnd`. Collection and PiggyVest settlement are separate gates.
Without that complete fresh pinned report, or after the fixed deadline,
generated metadata says `runtimeReadinessGateOpen: false`. Even a true report
only opens the review gate; `activationAuthorized` always remains false.

The Vercel candidate is built by the existing four-path transformer, with the
return path narrowed to GET. Nginx receives exact locations and method guards,
using the upstream identified by the pinned exact savings-goals location. The
renderer preserves all baseline bytes around the insertion; query strings stay
on the original request URI. Existing webhook, intake, drafts, wallet, and
fallback routes remain in the baseline. The generic Paystack first-card guard
and PiggyVest receiver source are not modified by this candidate lane.

The canonical source route modules are Next App Router inputs. The existing
staging standalone handoff is
`PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD=true pnpm --filter @baci/web build:ci`;
the expected entrypoint is `apps/web/.next/standalone/apps/web/server.js`, and
route presence should be checked in
`apps/web/.next/server/app-paths-manifest.json` before packaging. This lane did
not build or inspect that artifact, so artifact inclusion remains unverified.
