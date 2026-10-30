#!/usr/bin/env bash
set -euo pipefail

# Exercise the broker-owned production lock descriptor model on Linux. The
# repository mounts are read-only and all worker state is disposable.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
docker run --rm -i --network none --user 0 \
  -v "$repo_root/vps-workers/bin/worker_release_quiesce_locks.py:/source/worker_release_quiesce_locks.py:ro" \
  -v "$repo_root/.github/scripts/gigl-dotenv.sh:/source/gigl-dotenv.sh:ro" \
  --entrypoint bash node:24-bookworm -s <<'LINUX_TEST'
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "PASS: $*"; }
command -v python3 >/dev/null || fail 'python3 missing from test image'
command -v flock >/dev/null || fail 'flock missing from test image'

groupadd --system baci-worker
groupadd --system baci-locks
useradd --system --gid baci-worker --groups baci-locks --home-dir /nonexistent --shell /usr/sbin/nologin baci-worker
worker_uid="$(id -u baci-worker)"
worker_gid="$(id -g baci-worker)"
lock_gid="$(getent group baci-locks | cut -d: -f3)"
install -d -o root -g "$lock_gid" -m 0710 /srv/baci-workers
install -d -o root -g "$lock_gid" -m 0710 /srv/baci-workers/locks
install -d -o baci-worker -g baci-worker -m 0700 /srv/baci-workers/runtime
install -d -o root -g baci-worker -m 0550 /srv/baci-workers/releases
release_sha=0123456789abcdef0123456789abcdef01234567
install -d -o root -g baci-worker -m 0550 "/srv/baci-workers/releases/$release_sha/bin"
install -o root -g baci-worker -m 0440 /source/gigl-dotenv.sh "/srv/baci-workers/releases/$release_sha/bin/gigl-dotenv.sh"
ln -s "releases/$release_sha" /srv/baci-workers/current
printf 'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/error-remediator-global.lock\n' >/srv/baci-workers/runtime/worker.env
chown baci-worker:baci-worker /srv/baci-workers/runtime/worker.env
chmod 0600 /srv/baci-workers/runtime/worker.env
install -o root -g "$lock_gid" -m 0660 /dev/null /srv/baci-workers/locks/ordinary.lock
install -o root -g "$lock_gid" -m 0660 /dev/null /srv/baci-workers/locks/error-remediator-global.lock
install -o root -g "$lock_gid" -m 0660 /dev/null /srv/baci-workers/locks/gigl-tracking.lock

PYTHONPATH=/source python3 - "$lock_gid" "$worker_gid" <<'PY'
import fcntl
import os
from pathlib import Path
import sys
import time
from worker_release_quiesce_locks import (
    LockSetError, _trusted_current_dotenv_reader, acquire_lock_fds,
)

root = Path('/srv/baci-workers/locks')
lock = root / 'ordinary.lock'
lock_gid, worker_gid = map(int, sys.argv[1:])
reader = _trusted_current_dotenv_reader(worker_gid)
assert reader == Path('/srv/baci-workers/releases/0123456789abcdef0123456789abcdef01234567/bin/gigl-dotenv.sh')
held = acquire_lock_fds([lock], expected_uid=0, expected_gid=lock_gid,
                        deadline=time.monotonic() + 2, directory=root)
assert fcntl.fcntl(held[0], fcntl.F_GETFD) & fcntl.FD_CLOEXEC
try:
    try:
        acquire_lock_fds([lock], expected_uid=0, expected_gid=lock_gid,
                         deadline=time.monotonic() + 0.2, directory=root)
    except LockSetError:
        pass
    else:
        raise AssertionError('second open description acquired broker-held flock')
finally:
    os.close(held[0])
released = acquire_lock_fds([lock], expected_uid=0, expected_gid=lock_gid,
                            deadline=time.monotonic() + 2, directory=root)
os.close(released[0])
PY
ok 'current/bin dotenv reader resolves from the root-owned immutable release target'
ok 'broker-owned CLOEXEC flock remains exclusive until the broker closes its descriptor'
LINUX_TEST
