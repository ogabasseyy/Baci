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
- **Releases ship only commits on `main`.** Both release workflows first
  check that the commit they would build is on `main`, and stop if it is not.
  A tag on an unmerged branch, or a manual run started from another branch,
  fails before anything is built or uploaded.
- **No OTA updates from gated code.** The iOS OTA export refuses any source
  commit that contains the gate file. Commits from before the gate can still
  be exported.
- **A CI check keeps the gate honest.** The `Test storefront release gate` step
  of CI fails if:
  - a push trigger comes back on either release workflow, or the tag or
    manual-run trigger disappears;
  - the "on main" check or the OTA refusal step is removed, moved, moved to
    another job, or made skippable;
  - another workflow or a composite action under `.github/actions/` starts
    building, shipping or dispatching the storefront apps. A workflow may
    start another workflow only by naming its file literally (for example
    `gh workflow run security.yml`); starting one by display name, numeric ID
    or a variable fails, because the check cannot tell which workflow it is;
  - the CI step itself is made skippable or stops running one of the gate's
    test files;
  - a new PiggyVest storefront file has no server-off test.

Customers see no change when the gate merges.

## Before merging the gate (owner)

Confirm that the ATT fix build **2.1.528** has been submitted to App Review (or
released). After the gate merges, merging storefront code no longer submits a
build, so any later submission is a manual run of a workflow listed below.

## Making a deliberate release (owner)

Start from the Actions tab on `main`, or push a tag on a commit that is on
`main`. Anything else is refused.

| Platform | Manual run | Tag |
| --- | --- | --- |
| iOS | "iOS Storefront Production Release": builds, uploads to TestFlight and submits for App Review with automatic release. Leave the build number empty to use the next one. | `v<build>-storefront-ios`: the number becomes the build number and must be higher than the last one |
| Android | "Android Storefront Production Release" with `publish_to_play` on and the `internal` track, to test first. | `v<version code>-storefront`: publishes straight to 100% of production; the number must be higher than every version code already uploaded, including the internal test build |

For an iOS device test, run "iOS Storefront Production Release" on `main`
with `testflight_only` enabled. This manual option uploads the signed build to
TestFlight without submitting it for App Review; tag pushes always submit.
The automatic build number uses the workflow run number plus the configured
base, so a TestFlight-only build consumes a number and gaps are expected. A
tag build number must exceed every previously uploaded build, including these
TestFlight-only uploads. Select the build in TestFlight on the
device after processing and tester assignment. Record the tested app version
and build number. To submit that exact build later, enter both required values
in "iOS Storefront Submit for Review". Requiring both values pins the tested
build even if another upload happens concurrently. Check the latest App Store
release date and confirm that App Store Connect still offers the tested build. If a release
since the upload makes the build unavailable, rebuild and retest. Use a newer
version if the tested version has already gone live.
[Apple's build selection rules](https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit/).

Check the submit step's
result even when the workflow succeeds. In the separate "iOS Storefront Submit
for Review" workflow, submission is skipped if another build occupies the App
Review slot unless the owner explicitly selects `cancel_review_for_resubmit`
to withdraw the existing review. The production workflow summary distinguishes
TestFlight-only runs, actual App Review submissions, and uploads skipped
because the App Store version slot is occupied.

To resubmit a build that is already on TestFlight, run "iOS Storefront Submit
for Review".

### Android: ship exactly the commit you tested

Every run builds the commit it starts from. A second manual run with the
`production` track rebuilds whatever `main` is at that moment, which may
include changes merged after the internal test. To release exactly what was
tested:

1. Run "Android Storefront Production Release" with `publish_to_play` on and
   the `internal` track. Note the commit the run built (the run's commit SHA
   in GitHub Actions).
2. Test the internal build.
3. Push a production tag on that same commit:
   `git tag v<version code>-storefront <tested commit> && git push origin v<version code>-storefront`.
   The tag run rebuilds the tested commit, publishes it to production and
   points the in-app update prompt at it.

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
   `*.server-off.test.tsx` test for every new or changed storefront source file that is a
   PiggyVest file, and that test must import the file it covers (with a
   relative path or the `@/` alias) and declare at least one test that is not
   skipped or todo and makes an assertion. The test shows the file behaves like
   production when the server keeps PiggyVest off. An empty placeholder test,
   an import with skipped tests, or one that imports something else, does not count.

The gate also reads the scripts a workflow or action runs (for example
`bash .github/scripts/x.sh`), and the scripts those run, as part of that
workflow, so delegating a build, upload or dispatch to a script does not hide
it. Extensionless scripts (`bash scripts/release`, `./scripts/deploy`) are followed too. The same applies to a local composite action or reusable workflow a file
uses (`uses: ./.github/actions/x`): it is read as part of the caller, so
splitting the shipping across files does not hide it. A `.github` script,
action or workflow it cannot find fails the gate.

No workflow or action may create a release tag, a git ref or a GitHub release
(`git tag`, `git push --tags` or a `v*-storefront` tag, `POST /git/refs`,
`gh release create`, `createRelease`), because a tag push starts the gated
release workflows. Only the owner pushes release tags. Test files and the
gate's own modules are not followed. Each gated workflow keeps a single job,
because its guards cover that one job.

### Which files count, and where the test goes

A file counts when it is new or changed since the gate's baseline commit
(recorded in the gate file), is app source, and either has "PiggyVest", "wallet" or "savings"
in its path or mentions PiggyVest in its code. These are not app source:
tests, test helpers (`.test-support`, `.test-utils`, `.test-fixture`,
`.test-fixtures` and `-test-harness` files), mocks, type declarations,
`.styles.ts` and `.types.ts` files, and anything under `test-support/`,
`scripts/` or `tools/`.

| New file | Server-off test |
| --- | --- |
| `apps/mobile-storefront/components/wallet/WalletPinSheet.tsx` | `apps/mobile-storefront/components/wallet/WalletPinSheet.server-off.test.tsx`, or the same path under `apps/mobile-storefront/__tests__/` |
| `apps/mobile-storefront/app/wallet/pin.tsx` (a screen) | `apps/mobile-storefront/__tests__/app/wallet/pin.server-off.test.tsx` only |

Moving or renaming an existing PiggyVest file makes it new, so it needs a
server-off test too.

The baseline commit must be a commit on `main`. CI refuses a baseline that
exists only on a pull request branch: that commit disappears when the pull
request is squash-merged, and naming it would let the pull request's own new
files skip the rule.

## OTA updates while the gate is on

An urgent JavaScript fix cannot go out as an OTA update from a gated commit.
Ship it in a deliberate store release. Every merged change is safe to ship, so
that release is safe too.

## Checking the gate locally

```sh
node --test .github/scripts/storefront-release-gate*.test.mjs
```

The check needs full git history and an up-to-date `origin/main`
(`git fetch origin main`), because it compares against the baseline commit on
`main`. New files count once they are added to git or are untracked and not
ignored.

## Documented limitations

The gate reads workflows, composite actions under `.github/actions`, and the
scripts they reference. It is a guard against accidental shipping, not against
a deliberate edit of the guard itself. Any change under `.github/` needs the
owner's code-owner review, which is the control for deliberate tampering. These
shapes are therefore accepted and not hardened further:

- A local composite action or reusable workflow referenced from outside
  `.github/actions` and `.github/workflows` is not followed.
- A `github-script` dispatch whose parameters sit in an unrelated object
  (`createWorkflowDispatch(params)`) is matched with any literal `workflow_id`
  in the file rather than its own.
- An external reusable workflow or upload action (`uses: org/repo/...@ref`) is
  not followed.
- Re-running an existing gated run (`gh run rerun`, `/actions/runs/{id}/rerun`)
  is not treated as a dispatch.
- The server-off rule covers `apps/mobile-storefront` only, not PiggyVest code
  in `packages/shared`.
- A shell `cd apps/mobile-storefront` inside a `run:` block does not set the
  directory used to resolve the package scripts that follow it; use
  `working-directory:` (which the gate reads) instead.
- A parent-relative script path (`bash ../x.sh`) is not followed outside the
  repository root.
- The server-off test check reads test text heuristically: an all-inline
  `import { type X }`, a trailing `//` comment, or a `)` inside a regex literal
  in a live test can fool it.

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
5. Keeps the "on main" check in both release workflows and in the manual
   "iOS Storefront Submit for Review" workflow. It only refuses
   commits that never reached `main`, which should never ship.
