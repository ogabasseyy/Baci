#!/usr/bin/env bash
set -euo pipefail
exec node "$(dirname "$0")/probe-live-cache-invalidation-worker-route.mjs"
