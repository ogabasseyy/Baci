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
a forward revert that retains it. Download the verified artifact
from that run. It contains the
public Expo config, export, source maps and provenance. The workflow rejects a
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
misleading. This does not replace the native compatibility checks above. From a
checkout of current `main` that contains the verifier, recheck the downloaded
artifact with the following command (the target source commit may predate the
verifier):

Obtain the `Provenance SHA-256` value from the successful workflow attempt's
verification log, using GitHub as the trusted source. Do not derive the
trusted value from the downloaded artifact. Then run:

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

First publish the prebuilt `dist` with `eas update --skip-bundler --input-dir`
to an isolated, unmapped test branch. Point only a new test channel at that
branch, verify the manifest's platform, runtime, config and bundle hash, and
test an appropriate build without making a real payment. After review and
verification, publish the same artifact to the existing production channel;
do not change its branch mapping to the test branch. Verify the production
manifest and remove only the temporary test channel and branch. OTA prompts
require the customer to accept the update and reload the app.

Upload the generated source maps to the configured error-tracking providers
using their existing production credentials; see [PostHog observability](../posthog-observability.md).
Do not put build credentials in the artifact or Expo's public manifest.
