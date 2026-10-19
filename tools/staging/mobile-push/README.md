# Hosted-stage push build preparation (offline only)

This prepares a separately reviewed **development client**, not a production
release or a push send. It does not authenticate to EAS, create a project, start
a build, install an app, deploy, request permission, or register a device/token.
The checked-in hosted pins have **no `nativeStagingPush`**: capability stays off.
`eas.json` and all its standard profiles remain unchanged.

## Disabled templates

- `native-staging-push.template.json`: merge only the `nativeStagingPush` object
  into an owner-reviewed copy of the existing hosted pins. The three null
  identities are intentionally invalid, **not example project/package IDs**.
- `eas-profile.template.json`: deferred fragment containing **only**
  `build.hosted-staging-push`. Null public-key values intentionally refuse
  preparation. Supply the already pinned staging public key, equal in both
  fields; the preflight compares its hash without printing it. No private
  credentials belong in this fragment. Do not merge into `eas.json` yet.

Native pins must contain exactly `projectId`, `iosBundleIdentifier`,
`androidPackage`, `allowedOrigins`. Supply independently verified, owner-approved
staging identities. The production project and either production native ID are
refused, including case variants. The origins must be exactly, in order:
`https://staging.ogabassey.com`, `https://staging-auth.ogabassey.com`,
`https://exp.host`. API/auth origin, issuer, merchant and public-key fingerprint
must remain equal to the original source pins; no provider/customer scope widens.

## Local read-only checks

From the repository root:

```sh
pnpm exec node tools/staging/mobile-push/preflight.mjs
pnpm exec node tools/staging/mobile-push/preflight.mjs \
  --pins /private/tmp/reviewed-staging-pins.json \
  --profile /private/tmp/reviewed-eas-profile.json
pnpm exec node --test \
  apps/mobile-storefront/config/hosted-staging-push-build.test.mjs \
  apps/mobile-storefront/config/development-storefront-expo-config.test.mjs \
  tools/staging/mobile-push/preflight.test.mjs
```

Default preflight exits **1** because real native pins are absent. An accepted
candidate resolves the actual root `app.config.ts` in an isolated offline loader,
checks the native identity and both push/development-client plugins, and returns
`configResolutionVerified: true` plus the resolved manifest SHA-256. The loader
does not load dotenv, contact EAS or change `process.env`. Parent must compare
this source fingerprint to the actual build configuration.
It exits 0 with `prepared: true`, but always `buildAuthorized: false` and
`deviceAcceptanceVerified: false`. This is schema/pin validation only, not proof
that the project exists, signing works, an artifact was produced, or push works.
Outputs contain only booleans and fixed diagnostic categories, never keys,
account credentials, tokens, notification content, or arbitrary error text.

The builder's cloud exception requires all of `EAS_BUILD=true`, exact
`EAS_BUILD_PROFILE=hosted-staging-push`, and
`BACI_REVIEWED_HOSTED_PUSH_BUILD=1`, plus valid pins and matching environment.
It validates before normalizing a **copy** for the isolated development builder;
it never changes `process.env`. Generic EAS/CI and production profiles get no
exception. Production telemetry, competing local/phone-QA modes, missing pins,
changed hosts and changed keys refuse before a manifest is returned.
An explicit staging profile invokes this validation even if its EAS marker is
absent; it cannot fall through to the production factory. The normalized copy
retains `EAS_BUILD_PROFILE` for provenance after clearing its EAS/CI flags. The
builder continues with that copy in the same invocation and does not recursively
validate it. Reusing the normalized copy as a new external launch is refused.
Local hosted, cloud and resolved-manifest preflight paths share the same strict
native capability validator for formats, length, unknown fields, production IDs
and exact origins. Installed-identity preflight requires both the application ID
and its platform before reporting ready.

## Parent-owned remaining gates (no build authorized)

1. Fresh authenticated EAS inventory is required. CLI was unauthenticated during
   the read-only investigation; no separate staging project has been proven.
   Recover existing project/build IDs with owner authentication first. If none
   exists, obtain explicit approval for separate project/native registration,
   signing/push credentials and the bounded development-client build. Never reuse
   the production project or populate invented IDs.
2. Root `app.config.ts` now selects the validated development configuration
   before loading the extracted production configuration. The actual clean
   staging EAS entry point resolves without Facebook/PostHog/Sentry credentials.
   Production profiles retain their mandatory credential validation and exact
   native IDs/update configuration. The staging config explicitly adds
   `expo-dev-client` and `expo-notifications`. Compare the real resolved EAS
   environment and manifest to the source fingerprint before approving a build.
3. Review isolated native generation. Existing committed iOS/Android projects
   are not proof of staging identity; ensure the approved artifact is generated
   from the reviewed staging config, not the production native directories.
   Verify artifact project ID, both native IDs, notification plugin/entitlements,
   dev-client status, disabled updates and blank/excluded telemetry, using the
   existing hosted-staging push manifest preflight. Capture exact artifact/build
   identity and review the resolved EAS development environment separately.
4. The phone is disconnected: physical-device installation, genuine permission,
   native token registration and receipt acceptance remain unverified. Do not
   reset permission, register a fake Expo token, or send a push from this lane.
   Notification worker/runtime registration behavior remains fail-closed.

## Source validation and phone acceptance

Run the complete offline config/acceptance regressions:

```sh
pnpm exec node --test \
  apps/mobile-storefront/config/hosted-staging-push-capability.test.mjs \
  apps/mobile-storefront/config/hosted-staging-push-app-config.test.mjs \
  apps/mobile-storefront/config/hosted-staging-push-build.test.mjs \
  apps/mobile-storefront/config/hosted-staging-push-preflight.test.mjs \
  apps/mobile-storefront/config/development-storefront-expo-config.test.mjs \
  apps/mobile-storefront/config/development-storefront-expo-config-production.test.mjs \
  tools/staging/mobile-push/preflight.test.mjs \
  tools/staging/mobile-push/resolve-config.test.mjs \
  tools/staging/mobile-push/acceptance.test.mjs \
  tools/staging/mobile-push/schemas/acceptance.test.mjs
```

`acceptance.template.json` is a disabled observation form. Strict evidence
validation lives in the strict `schemas/acceptance.mjs` schema, imported by the
harness; its colocated tests cover every protected literal and nested boundary.
All identity/evidence hash fields start null, and all acceptance booleans start
false. Parent supplies
independently reviewed evidence; never include push tokens, passwords, signing
material, provider payloads or customer identities. The checker rejects extra
fields, mismatched manifest/build/application identities or build/device
platforms, absent signing/push
credentials, simulators, missing permission/registration, missing foreground,
background or cold-start receipt, and missing scoped wallet/goal refresh.
Genuine provider-paid net-interest wording and duplicate safety are separate
from sample preview. The preview must visibly say it is simulated and leave
persisted balances unchanged.

```sh
pnpm exec node tools/staging/mobile-push/acceptance.mjs
pnpm exec node tools/staging/mobile-push/acceptance.mjs \
  --pins /private/tmp/reviewed-staging-pins.json \
  --profile /private/tmp/reviewed-eas-profile.json \
  --evidence /private/tmp/reviewed-phone-evidence.json
```

The default exits 1. Complete supplied evidence exits 0 with `evidenceAccepted`,
but always leaves `deviceAcceptanceVerified`, `providerPayoutVerified` and
`buildAuthorized` false, with `parentEvidenceReviewRequired: true`. Hashes and
assertions are input evidence, not independent proof of a build, device or payout.
Observations must be no older than 24 hours and not in the future. Acceptance
refuses at or after `2026-10-06T15:59:10Z`. The form enforces unchanged 10,000-kobo
principal and total approved prefunding, financial replay/background/snapshot
off, and read-only checkout GET 200/false/max0 and POST/PATCH 503.

For native generation, parent must use a disposable reviewed source checkout
with this app config, approved hosted pins and the isolated EAS fragment. Exclude
the existing production `ios`/`android` trees and production Google services
files; generate fresh native code there from staging config. Match real staging
FCM/APNs credentials to approved native IDs and signing before any build.
EAS local evaluation must receive the exact reviewed profile/build markers and
pinned public environment too. The offline loader verifies the cloud guard but
does not substitute for actual EAS local/config resolution. Install the exact
reviewed signed artifact on the physical phone before capturing evidence.
Neither these CLIs nor this lane create projects/builds or perform registration,
delivery or financial writes.
