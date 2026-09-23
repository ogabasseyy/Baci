#!/usr/bin/env bash

set -euo pipefail

remote_dir="${VPS_WORKER_REMOTE_DIR:-/home/bassey/baci-workers}"

echo "==> Verifying the production cache-invalidation drain on the deploy runner"

if [ ! -f "$remote_dir/jobs/run-cache-invalidation-cron.mjs" ]; then
  echo "Cache-invalidation drain runner is not installed at $remote_dir/jobs/run-cache-invalidation-cron.mjs." >&2
  exit 1
fi

if ! installed_crontab="$(crontab -l 2>/dev/null)"; then
  echo "The VPS worker crontab is not installed." >&2
  exit 1
fi

drain_count="$(
  printf '%s\n' "$installed_crontab" | awk -v remote_dir="$remote_dir" '
    $1 == "*/2" && $2 == "*" && $3 == "*" && $4 == "*" && $5 == "*" &&
    index($0, "flock -n " remote_dir "/locks/cache-invalidations.lock") &&
    (runner_pos = index($0, remote_dir "/jobs/run-cache-invalidation-cron.mjs")) &&
    substr($0, runner_pos + length(remote_dir "/jobs/run-cache-invalidation-cron.mjs") + 1, 1) ~ /^[[:space:]\047"]$/ &&
    index($0, "CACHE_INVALIDATION_STATE_FILE=" remote_dir "/state/cache-invalidations.json") &&
    index($0, ">> " remote_dir "/logs/cache-invalidations.log 2>&1") {
      count += 1
    }
    END { print count + 0 }
  '
)"

if [ "$drain_count" -ne 1 ]; then
  echo "Expected exactly one active two-minute cache-invalidation drain; found $drain_count." >&2
  echo "Run bash vps-workers/deploy.sh from a clean exact-SHA checkout, then rerun production deployment." >&2
  exit 1
fi

echo "Cache-invalidation drain is installed."
