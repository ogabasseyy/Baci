#!/usr/bin/env bash
# Smokes the live restricted GIGL wrapper capability on the worker host.
# Runs on the deploy runner with VPS_WORKER_REMOTE_DIR pointing at the
# installed worker directory (default /home/bassey/baci-workers).
set -euo pipefail

remote_dir="${VPS_WORKER_REMOTE_DIR:-/home/bassey/baci-workers}"
NODE_ENV=production BACI_WORKER_PROFILE=gigl-tracking BACI_WORKER_ENV="$remote_dir/.env" "$remote_dir/bin/verify-gigl-tracking-worker-capability.sh"
