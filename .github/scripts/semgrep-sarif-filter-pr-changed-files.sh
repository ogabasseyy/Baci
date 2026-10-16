#!/usr/bin/env bash
# Prints the security-relevant files changed between the given base
# ref and HEAD (one per line) for the Semgrep PR scan in
# security.yml. Exits nonzero when the diff itself fails, so callers
# fail closed instead of scanning an empty scope; a successful diff
# with no matching files prints nothing and still exits 0, which
# callers treat as a legitimate skip. No third-party deps.
set -euo pipefail
base="$1"
diff_out="$(git diff --name-only --diff-filter=d "$base...HEAD" -- \
  '*.js' '*.jsx' '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.sql' '*.yml' '*.yaml')" || {
  echo "::error::PR base diff failed for [$base]; failing closed instead of skipping the scan."
  exit 1
}
grep -E '^(next\.config\.ts$|apps/web/src/app/api/|apps/web/src/lib/|apps/web/src/schemas/|apps/mobile-admin/(app|hooks|lib)/|apps/mobile-storefront/(app|hooks|lib|services|stores)/|packages/shared/|supabase/migrations/|\.github/workflows/)' <<<"$diff_out" || true
