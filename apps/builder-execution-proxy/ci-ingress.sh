#!/usr/bin/env bash
set -euo pipefail

version=2.11.4
release="https://github.com/caddyserver/caddy/releases/download/v$version"
asset="caddy_${version}_linux_amd64"
archive="$asset.tar.gz"
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/baci-caddy.XXXXXXXX")

for file in "$archive" "$archive.sig" "$asset.pem"; do
  curl --fail --silent --show-error --location --proto '=https' \
    --proto-redir '=https' --retry 2 --max-time 60 \
    "$release/$file" --output "$work/$file"
done

# SHA-256 from the release asset metadata and SHA-512 from the release checksums.
printf '%s  %s\n' '527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9' "$work/$archive" | sha256sum --check
printf '%s  %s\n' '8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9' "$work/$archive" | sha512sum --check

# GoReleaser publishes the certificate PEM and signature as base64.
base64 --decode "$work/$asset.pem" > "$work/caddy-signing.pem"
cosign verify-blob --timeout 120s \
  --certificate "$work/caddy-signing.pem" \
  --signature "$work/$archive.sig" \
  --certificate-identity "https://github.com/caddyserver/caddy/.github/workflows/release.yml@refs/tags/v$version" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "$work/$archive"

tar -xzf "$work/$archive" -C "$work" caddy
BACI_TEST_CADDY="$work/caddy" python3 apps/builder-execution-proxy/ingress.test.py
