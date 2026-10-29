# Storefront iOS OTA exports

The storefront's production settings currently live in the native release
workflow's GitHub secrets. An ordinary `eas update --environment production`
does not inherit those settings. Use the **Prepare storefront iOS OTA export**
workflow to build a reviewed main-branch commit with the same public settings
as its native release. The workflow only prepares an artifact; it does not
publish an update or hold an Expo access token.

Before exporting, establish the target app's actual embedded runtime, build
number, Expo project and channel from the installed binary or its release
artifact. Compare the target native release's source with the update source,
including native modules, dependencies, patches and config. OTA can only carry
compatible JavaScript and assets. Required native-update gates take priority;
some older storefront builds also show a recommended store update before
checking for OTA updates.

Read the existing `extra.tiktokBusiness.isConfigured` boolean from the target
native binary and the current production OTA manifest for that runtime, if one
exists. They must agree; stop and investigate any mismatch or staged rollout
with different values. Supply the verified value to the workflow. It preserves
this client capability without placing the TikTok build secret in the manifest.

Dispatch the workflow on `main` with the full reviewed source SHA, runtime,
build number and verified TikTok capability. The selected source must embed
`EXPO_PUBLIC_BUILD_SHA` so the exported bundle can be checked against that
revision. To roll back to older source without this marker, create and review
a forward revert that retains it. Download the verified artifact from that
run. It contains the public Expo config, export, source maps and provenance.
The artifact expires after one day. If it expires, rerun the workflow with
the same inputs and use the new run's verification-log provenance digest.
The workflow rejects a
runtime or merchant mismatch, missing required client configuration and known
build-only secrets in the artifact. Do not add the TikTok app secret to the
export step: Expo's public config includes plugin options.

For publication, use a clean checkout at the artifact's `sourceSha`. Create an
ignored temporary project under `apps/mobile-storefront/.expo/`, copy the
storefront `package.json` and `eas.json`, symlink its `config` directory, and
write the artifact's `expo-config.json` as `{ "expo": <config> }` in `app.json`.
Confirm Expo resolves the same public config in that temporary project. Set
`EAS_SKIP_AUTO_FINGERPRINT=1` for publication: the temporary project's native
tree is incomplete, so its automatically calculated fingerprint would be
misleading. This does not replace the native compatibility checks above.
Obtain the `Provenance SHA-256` value from the successful workflow attempt's
verification log, using GitHub as the trusted source. Do not derive the
trusted value from the downloaded artifact. From a checkout of current `main`
that contains the verifier (the target source commit may predate it), run:

```sh
node .github/scripts/verify-storefront-ota-export.mjs \
  /absolute/path/to/artifact 2.1.663 FULL_SOURCE_SHA --public-only TRUSTED_PROVENANCE_SHA256
```

Substitute the artifact's own runtime and source SHA. `--public-only` checks
the trusted provenance digest and hashes of the config, bundle, maps and assets
without scanning private values; the successful workflow run performed that
scan with the existing GitHub secrets.
This avoids rebuilding with the empty EAS environment and preserves the
reviewed source revision in EAS provenance. Keep the artifact and temporary
files restricted to authorized operators; the source maps contain application
source.

Before publishing, compare the export's full public Expo config with the config
extracted from the verified target binary. If a production OTA already exists
for the runtime, compare against its current manifest config as well. Current
GitHub secrets can differ from those used for an older build; identical secret
expressions in the workflows do not prove identical values. This comparison
removes only the target binary's build-only TikTok plugin entry, whose options
may contain a secret. It prints no config values:

```sh
node - /absolute/path/to/verified-target-config.json /absolute/path/to/artifact/expo-config.json <<'NODE'
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const [targetPath, updatePath] = process.argv.slice(2);
const target = JSON.parse(readFileSync(targetPath, 'utf8'));
const update = JSON.parse(readFileSync(updatePath, 'utf8'));
const isTiktokPlugin = (plugin) =>
  (Array.isArray(plugin) ? plugin[0] : plugin) === '@baci/tiktok-business/plugin';
if ((update.plugins ?? []).some(isTiktokPlugin)) {
  throw new Error('The update contains the build-only TikTok plugin.');
}
const publicTarget = Array.isArray(target.plugins)
  ? { ...target, plugins: target.plugins.filter((plugin) => !isTiktokPlugin(plugin)) }
  : target;
if (!isDeepStrictEqual(publicTarget, update)) {
  console.error('Public Expo config differs from the target. Stop and review the drift.');
  process.exit(1);
}
console.log('Public Expo config matches the target.');
NODE
```

Stop if the configs differ. Investigate and explicitly review every change
before proceeding, especially the backend URL, public key, merchant and update
settings; do not assume a mismatch is safe.

The Expo config comparison does not cover values that Metro inlines directly
into JavaScript. Compare the export's inlined production settings with trusted
values from the target build, including the mobile-ad enable flags and ad-unit
IDs. Obtain those values from verified build provenance or the target bundle;
avoid printing them. Review any drift explicitly, and stop if the values cannot
be established reliably. Matching workflow secret expressions is not evidence
that their historical values match.

First publish the prebuilt `dist` with `eas update --skip-bundler --input-dir`
to an isolated test branch. Point a new `ota-test-*` channel at that branch and
verify the manifest's platform, runtime, config and bundle hash. The released
production binary cannot receive this channel: it embeds `production`, and the
app has no channel switcher. Do not mistake a production-channel response for
an installed-app test of the candidate.

Build a separate release-mode iOS Simulator app from the target binary's native
source revision and exact dependency lockfile, using the same production native
configuration and public environment. Use a clean, isolated checkout: Expo
prebuild and the test-channel plist change native files there. After prebuild,
extract `Payload/Ogabassey.app/Expo.plist` from the verified target IPA and use
the current `main` helper to create a new plist. The helper refuses an existing
output and preserves every target setting except the channel:

```sh
python3 .github/scripts/prepare-storefront-ota-test-plist.py \
  --source /absolute/path/to/verified-target-Expo.plist \
  --output /absolute/path/to/new-test-Expo.plist \
  --runtime "$TARGET_RUNTIME" --channel "$TEST_CHANNEL" \
  --source-channel production --updates-url "$VERIFIED_UPDATES_URL"
```

Copy the generated test plist to `ios/Ogabassey/Supporting/Expo.plist` in the
isolated test checkout, then build the `Ogabassey` scheme in Release mode for
`iphonesimulator` with code signing disabled. Inspect the built app's
`Expo.plist`: updates must be enabled and its project URL, runtime and channel
must match the verified target and the new test channel. Use a dedicated test
simulator without an existing Ogabassey installation or customer session.
Install the test build, verify it fetches and runs the candidate update, and
exercise the relevant flow without making a real payment. Stop if a compatible
test build or its settings cannot be verified.

After review and verification, publish the same artifact to the existing
production channel; do not change its branch mapping to the test branch.
Verify the production manifest and remove only the temporary test channel and
branch. OTA prompts require the customer to accept the update and reload the
app.

Upload the generated source maps to the configured error-tracking providers
using their existing production credentials; see [PostHog observability](../posthog-observability.md).
Do not put build credentials in the artifact or Expo's public manifest.
