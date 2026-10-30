# Storefront Android OTA runtimes

New Android builds use an Expo fingerprint runtime derived from their native
configuration and dependencies. The GitHub release workflow supplies the same
Android version code during prebuild and bundling. When preparing an update,
obtain the runtime from the verified target binary and confirm the update has
that exact runtime; do not assume that a fingerprint calculated in a different
checkout, native tree or build environment will match it.

An OTA can reach every installed binary sharing its runtime and channel,
including during native error recovery. Before publishing, verify native
compatibility and production configuration for all such binaries and validate
the candidate on an isolated channel. Historical Android builds using the
`2.0.1-android-sdk57-rn0862` runtime do not have a proven common native
configuration; do not publish to that runtime until every eligible target has
been qualified.

The iOS artifact-only export workflow is not an Android publisher. An Android
update still requires a reviewed export and publication process with verified
production settings, provenance, source maps and isolated-device checks.
