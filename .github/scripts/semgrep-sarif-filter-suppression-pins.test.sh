#!/usr/bin/env bash
# Pins for in-repo nosemgrep suppressions of dismissed SAST findings.
# Each suppression must sit on the line directly above its finding;
# drift (deleted comment, moved code) re-fires the required gate, so
# removing a pin here requires removing the finding too. Whether the
# suppressions WORK is verified live: every PR/push/scheduled scan
# runs the real rules and fails closed on findings. No third-party deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

fail=0
# Positional check: the anchor must match exactly one line, the
# nosemgrep must be the immediately preceding line, and the dismissal
# rationale the line above that. A passing pin therefore proves the
# specific finding occurrence is suppressed, not just that the file
# mentions the rule somewhere.
pinned_above() { # file anchor-literal rule-id
  local file="$ROOT/$1" anchor="$2" rule="$3" n line prev prev2
  n="$(grep -cF "$anchor" "$file")"
  if [[ "$n" -ne 1 ]]; then
    echo "::error::anchor [$anchor] matches $n lines in $1 (want exactly 1)"
    fail=1
    return
  fi
  line="$(grep -nF "$anchor" "$file" | cut -d: -f1)"
  prev="$(sed -n "$((line - 1))p" "$file")"
  prev2="$(sed -n "$((line - 2))p" "$file")"
  if [[ "$prev" != *"nosemgrep: $rule"* ]]; then
    echo "::error::missing above-line nosemgrep $rule for [$anchor] in $1"
    fail=1
  fi
  if [[ "$prev2" != *"code-scanning"* ]]; then
    echo "::error::missing dismissal rationale above nosemgrep for [$anchor] in $1"
    fail=1
  fi
}

FMT='javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring'
pinned_above apps/web/src/app/api/domains/check-availability/route.ts \
  'Error looking up suggestion' "$FMT"
pinned_above apps/web/src/app/api/inventory/push-alerts/route.ts \
  'Failed to notify for alert' "$FMT"
pinned_above apps/web/src/app/api/payments/initialize/route.ts \
  'MAX_POLL_ATTEMPTS}] Session' "$FMT"
pinned_above apps/web/src/app/api/payments/initialize/route.ts \
  'Payment Check' "$FMT"
pinned_above apps/web/src/lib/embeddings.ts \
  'Error generating embedding' "$FMT"
pinned_above apps/web/src/app/api/integrations/google-merchant-center/feed/route.ts \
  'NextResponse.redirect(redirectUrl, 308)' \
  'javascript.express.open-redirect-deepsemgrep.open-redirect-deepsemgrep'
pinned_above apps/web/src/lib/piggyvest/runtime-composition-auth.ts \
  'request.cookies.set(name, value);' \
  'javascript.koa.web.cookies-default-koa.cookies-default-koa'
pinned_above apps/web/src/lib/supabase/middleware.ts \
  'request.cookies.set(name, value);' \
  'javascript.koa.web.cookies-default-koa.cookies-default-koa'

if [[ "$fail" -eq 0 ]]; then
  echo "suppression pins: OK (8 sites)"
fi
exit "$fail"
