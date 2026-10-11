#!/usr/bin/env bash
set -euo pipefail

: "${POSTHOG_RELEASE_CLI:?POSTHOG_RELEASE_CLI must point to the installed CLI}"
# Clone/injection and other commands retain the SDK's strict failure behavior.
if [[ "${1:-}" != hermes || "${2:-}" != upload ]]; then
  exec "$POSTHOG_RELEASE_CLI" "$@"
fi

# Make retries conflict-safe: when the server persists a symbol set but the
# response is lost, the retry would otherwise die on a fatal 409. The Xcode
# helper only passes --skip-on-conflict when POSTHOG_SKIP_ON_CONFLICT is
# exported, which no release job sets, so inject it here (mirroring the dSYM
# wrapper in ios-release.yml). Dedupe so explicit callers keep a single flag.
has_skip_flag=false
for arg in "$@"; do
  if [[ "$arg" == --skip-on-conflict ]]; then has_skip_flag=true; break; fi
done
if [[ "$has_skip_flag" == false ]]; then set -- "$@" --skip-on-conflict; fi

output_file=$(mktemp)
trap 'rm -f "$output_file"' EXIT
for attempt in 1 2 3; do
  if "$POSTHOG_RELEASE_CLI" "$@" >"$output_file" 2>&1; then
    cat "$output_file"
    exit 0
  else
    status=$?
  fi
  # Retry only transport failures. Authentication, malformed maps, missing
  # configuration, and HTTP 5xx API responses require a fix (or a healthy
  # backend) and must still fail the archive immediately: 5xx is
  # intentionally fatal, not an oversight, because the CLI surfaces no
  # reliable transient-vs-fatal distinction for status errors.
  if [[ "$attempt" == 3 ]] || ! grep -Eiq 'error sending request|connection (reset|refused|closed)|timed out|network request failed|temporary failure in name resolution|EAI_AGAIN|ECONNRESET|ENOTFOUND|getaddrinfo|socket hang up' "$output_file"; then
    if [[ "$attempt" != 3 ]]; then
      echo "error: PostHog Hermes upload failed with non-transport output; not retrying (see output above)." >&2
    fi
    cat "$output_file"
    exit "$status"
  fi
  echo "warning: PostHog Hermes upload transport failure; retrying ($attempt/3)." >&2
  sleep "$((attempt * 5))"
done
