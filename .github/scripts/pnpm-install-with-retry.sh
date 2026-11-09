#!/usr/bin/env bash
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 [pnpm install args...]"
  exit 1
fi

MAX_ATTEMPTS=${MAX_ATTEMPTS:-3}
BACKOFF_SECONDS=${BACKOFF_SECONDS:-10}
RETRY_CHILD_CONCURRENCY=${PNPM_RETRY_CHILD_CONCURRENCY:-1}
RETRY_PACKAGE_IMPORT_METHOD=${PNPM_RETRY_PACKAGE_IMPORT_METHOD:-copy}
STORE_DIR=${PNPM_STORE_DIR:-}

cleanup_install_artifacts() {
  echo "Cleaning install artifacts before retry..."
  rm -rf node_modules apps/*/node_modules packages/*/node_modules

  if [ -n "$STORE_DIR" ]; then
    rm -rf "$STORE_DIR"
    pnpm config set store-dir "$STORE_DIR"
  fi
}

cleanup_stale_workspace_install() {
  local modules_file="node_modules/.modules.yaml"

  if [ ! -f "$modules_file" ]; then
    return
  fi

  local recorded_store_dir
  recorded_store_dir="$(sed -n "s/^storeDir: ['\"]\\{0,1\\}\\(.*\\)['\"]\\{0,1\\}[[:space:]]*$/\\1/p" "$modules_file" | head -n 1)"

  if [ -z "$recorded_store_dir" ]; then
    return
  fi

  if [ ! -d "$recorded_store_dir" ]; then
    echo "Detected stale node_modules metadata for missing pnpm store: $recorded_store_dir"
    cleanup_install_artifacts
    return
  fi

  if [ -n "$STORE_DIR" ] && [ "$recorded_store_dir" != "$STORE_DIR" ]; then
    echo "Detected node_modules linked to a different pnpm store: $recorded_store_dir"
    cleanup_install_artifacts
  fi
}

cleanup_stale_workspace_install

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "pnpm install attempt $attempt/$MAX_ATTEMPTS..."
  log_file=$(mktemp)

  if [ "$attempt" -gt 1 ]; then
    # pnpm worker/import races can surface as opaque Worker exits on the
    # self-hosted deploy runner. Retry with conservative import settings.
    export npm_config_child_concurrency="$RETRY_CHILD_CONCURRENCY"
    export npm_config_package_import_method="$RETRY_PACKAGE_IMPORT_METHOD"
  fi

  if pnpm install "$@" 2>&1 | tee "$log_file"; then
    rm -f "$log_file"
    echo "pnpm install succeeded on attempt $attempt"
    exit 0
  fi

  should_retry=false
  if grep -Eq "ERR_PNPM_ENOENT|Worker pnpm#[0-9]+ exited with code 1|GET .* error \\(unknown\\)|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_FETCH|ERR_SQLITE_ERROR|database disk image is malformed|Error fetching release: HTTP 504 from https://github[.]com/PostHog/posthog/releases/download/" "$log_file"; then
    should_retry=true
  fi

  rm -f "$log_file"

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ] || [ "$should_retry" != true ]; then
    echo "pnpm install failed after $attempt attempt(s)"
    exit 1
  fi

  cleanup_install_artifacts
  echo "Retrying pnpm install in ${BACKOFF_SECONDS}s..."
  sleep "$BACKOFF_SECONDS"
done
