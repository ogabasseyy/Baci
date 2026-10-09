#!/usr/bin/env bash
set -euo pipefail

: "${POSTHOG_RELEASE_CLI:?POSTHOG_RELEASE_CLI must point to the installed CLI}"
# Clone/injection and other commands retain the SDK's strict failure behavior.
if [[ "${1:-}" != hermes || "${2:-}" != upload ]]; then
  exec "$POSTHOG_RELEASE_CLI" "$@"
fi

output_file=$(mktemp)
trap 'rm -f "$output_file"' EXIT
for attempt in 1 2 3; do
  if "$POSTHOG_RELEASE_CLI" "$@" >"$output_file" 2>&1; then
    cat "$output_file"
    exit 0
  else
    status=$?
  fi
  # Retry only transport failures. Authentication, malformed maps, and missing
  # configuration require a fix and must still fail the archive immediately.
  if [[ "$attempt" == 3 ]] || ! grep -Eiq 'error sending request|connection (reset|refused|closed)|timed out|network request failed|temporary failure in name resolution' "$output_file"; then
    cat "$output_file"
    exit "$status"
  fi
  echo "warning: PostHog Hermes upload transport failure; retrying ($attempt/3)." >&2
  sleep "$((attempt * 5))"
done
