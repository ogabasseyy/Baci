#!/usr/bin/env bash
set -euo pipefail

if [ "${RUNNER_ENVIRONMENT:-}" = "self-hosted" ]; then
  pnpm --filter @baci/web exec vitest run --shard="${VITEST_SHARD}/6" --maxWorkers=4
else
  pnpm --filter @baci/web exec vitest run --shard="${VITEST_SHARD}/6"
fi
