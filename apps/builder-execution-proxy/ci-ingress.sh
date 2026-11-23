#!/usr/bin/env bash
set -euo pipefail

version=2.11.9
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
printf '%s  %s\n' '5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb' "$work/$archive" | sha256sum --check
printf '%s  %s\n' '0e85544340290a16ce4bfb76fe7d65e9de1bf3a6e67f5ccfff30b30d27ea4c73e078077b7bf3e58ae60b6b12e44327705287059c775bca5782e8ee85ea7edd75' "$work/$archive" | sha512sum --check

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
