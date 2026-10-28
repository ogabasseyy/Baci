#!/usr/bin/env bash
set -euo pipefail

# Run the worker migration transaction suites inside a clean Linux container.
# The repository is read-only, networking is disabled, and Docker receives no
# host environment. Each suite uses temporary directories and synthetic tools.

repo_root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
image="${BACI_WORKER_MIGRATION_TEST_IMAGE:-node:24-bookworm}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for the Linux migration integration run" >&2
  exit 2
fi

docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,exec,size=1g \
  --tmpfs /run:rw,nosuid,nodev,exec,size=64m \
  --mount "type=bind,src=${repo_root},dst=/repo,readonly" \
  --workdir /repo \
  --env PATH=/usr/local/bin:/usr/bin:/bin \
  --env HOME=/tmp \
  "$image" bash -lc '
    set -euo pipefail
    test "$(uname -s)" = Linux
    printf "%s\n" "[1/6] Provision isolated worker and release identities"
    python3 vps-workers/bin/provision-baci-worker.test.py
    python3 vps-workers/bin/provision-worker-release-boundary.test.py
    printf "%s\n" "[2/6] Provision the cron lock namespace"
    python3 vps-workers/bin/provision-release-locks.test.py
    printf "%s\n" "[3/6] Migrate legacy lock paths transactionally"
    python3 vps-workers/bin/migrate-worker-lock-namespace.test.py
    printf "%s\n" "[4/6] Migrate event/quiz cron workers to system services"
    python3 vps-workers/bin/migrate-event-workers-to-system-services.test.py
    printf "%s\n" "[5/6] Migrate GIGL and cache schedulers with rollback cases"
    node --test vps-workers/bin/migrate-gigl-tracking-system-service.test.mjs
    python3 vps-workers/bin/migrate-cache-invalidation-system-service.test.py
    printf "%s\n" "Linux worker migration integration suites passed"
  '
