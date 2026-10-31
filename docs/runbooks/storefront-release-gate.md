# Storefront release gate

While the PiggyVest customer work lands on `main` in small pull requests, the
storefront apps (iOS and Android) reach customers' phones only through one
deliberate release that the owner starts. The gate is on while
`.github/storefront-release-gate.json` exists.

The gate decides **when** code reaches phones. It does not hide anything. Any
release the owner starts, for any reason, ships everything already merged, so
every storefront PiggyVest change must be safe to ship the moment it merges.

## What the gate changes

- **No automatic store releases.** Before the gate, every merge that touched
  the storefront app, `packages/shared`, root `package.json`, `pnpm-lock.yaml`
  or `patches/` built the apps, submitted iOS for App Review with automatic
  release, and published Android to 100% of production. Now the iOS and
  Android storefront release workflows start only from an owner tag or a
  manual run ("Run workflow" in GitHub Actions).
- **No OTA updates from gated code.** The iOS OTA export refuses any source
  commit that contains the gate file. Commits from before the gate can still
  be exported.
- **A CI check keeps the gate honest.** The `Test storefront release gate` step
  of CI fails if a push trigger comes back on either release workflow, the tag
  or manual-run trigger disappears, the OTA refusal step is removed or moved,
  another workflow starts building, shipping or dispatching the storefront
  apps, or a new PiggyVest storefront file has no server-off test.

Customers see no change when the gate merges.

## Before merging the gate (owner)

Confirm that the ATT fix build **2.1.528** has been submitted to App Review (or
released). After the gate merges, merging storefront code no longer submits a
build, so any later submission is a manual run of a workflow listed below.

## Making a deliberate release (owner)

Start from the Actions tab on `main`, or push a tag from `main`.

| Platform | Manual run | Tag |
| --- | --- | --- |
| iOS | "iOS Storefront Production Release": builds, uploads to TestFlight and submits for App Review with automatic release. Leave the build number empty to use the next one. | `v<build>-storefront-ios`: the number becomes the build number and must be higher than the last one |
| Android | "Android Storefront Production Release" with `publish_to_play` on: choose the `internal` track first, then `production`. | `v<version code>-storefront`: publishes straight to production; the number must be higher than the current one |

To resubmit a build that is already on TestFlight, run "iOS Storefront Submit
for Review".

## Rules for storefront PiggyVest pull requests

1. **Server-gated.** New screens, entry points and flows show only on an
   explicit server verdict. When the server says no, does not answer, or
   answers in today's response shape, the app behaves exactly like the current
   production build.
2. **Removals only on explicit verdicts.** Today's funding, savings and payment
   options are hidden only when the server explicitly says the customer has
   moved to PiggyVest, never because a request failed.
3. **No unapproved legal copy.** Terms, consent and fee wording comes from the
   server or has the owner's written approval in the pull request.
4. **A server-off test for each new PiggyVest file.** The CI gate requires a
   `*.server-off.test.tsx` test for every new storefront source file that is a
   PiggyVest file. That test shows the file behaves like production when the
   server keeps PiggyVest off.

### Which files count, and where the test goes

A file counts when it is new since the gate's baseline commit (recorded in the
gate file), is app source (not a test, test helper, mock, type declaration,
`.styles.ts`, `.types.ts`, or anything under `test-support/`, `scripts/` or
`tools/`), and either has "PiggyVest", "wallet" or "savings" in its path or
mentions PiggyVest in its code.

| New file | Server-off test |
| --- | --- |
| `apps/mobile-storefront/components/wallet/WalletPinSheet.tsx` | `apps/mobile-storefront/components/wallet/WalletPinSheet.server-off.test.tsx`, or the same path under `apps/mobile-storefront/__tests__/` |
| `apps/mobile-storefront/app/wallet/pin.tsx` (a screen) | `apps/mobile-storefront/__tests__/app/wallet/pin.server-off.test.tsx` only |

Moving or renaming an existing PiggyVest file makes it new, so it needs a
server-off test too.

## OTA updates while the gate is on

An urgent JavaScript fix cannot go out as an OTA update from a gated commit.
Ship it in a deliberate store release. Every merged change is safe to ship, so
that release is safe too.

## Checking the gate locally

```sh
node --test .github/scripts/storefront-release-gate.test.mjs \
  .github/scripts/storefront-release-gate-workflows.test.mjs \
  .github/scripts/storefront-release-gate-server-off.test.mjs
```

The check needs full git history, because it compares against the baseline
commit. New files count once they are added to git or are untracked and not
ignored.

## Ending the gate (cutover)

The cutover follows the one deliberate PiggyVest release and needs the owner's
go-ahead, because merging it turns automatic store releases back on. The
cutover pull request:

1. Restores the push trigger in both release workflows. iOS:

   ```yaml
   on:
     push:
       branches:
         - main
       paths:
         - 'apps/mobile-storefront/**'
         - 'packages/shared/**'
         - 'package.json'
         - 'pnpm-workspace.yaml'
         - '.npmrc'
         # pnpm patches ship native code (e.g. expo-modules-jsi); a patch or
         # lockfile-only change must still trigger a release build.
         - 'patches/**'
         - 'pnpm-lock.yaml'
       tags:
         - 'v*-storefront-ios'
   ```

   Android uses the same `branches` and `paths` (its comment reads
   "Patch/lockfile changes rebuild ReactAndroid from source.") with the tag
   `"v*-storefront"`.
2. Deletes `.github/storefront-release-gate.json`.
3. Replaces the gate check with one that asserts the restored triggers, and
   removes the `Test storefront release gate` CI step.
4. Decides on the OTA refusal step. Keeping it is harmless: it only refuses
   commits from the gate period, which the deliberate release already covers.
