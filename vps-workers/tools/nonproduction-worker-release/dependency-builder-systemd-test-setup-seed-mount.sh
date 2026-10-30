# Sourced by dependency-builder-systemd-test-setup.sh in the same shell.

# Exercise the action-style shell shim: readlink resolves to the shim itself,
# while package discovery must select the actual pnpm.cjs entrypoint.
shim_fixture="$test_root/pnpm-shim-regression"
install -d "$shim_fixture/node_modules/.bin" "$shim_fixture/node_modules/pnpm/bin"
cat >"$shim_fixture/node_modules/pnpm/bin/pnpm.cjs" <<'JS'
#!/usr/bin/env node
if (process.argv[2] === '--version') process.stdout.write('11.7.0\n');
JS
chmod 0755 "$shim_fixture/node_modules/pnpm/bin/pnpm.cjs"
cat >"$shim_fixture/node_modules/.bin/pnpm" <<'SH'
#!/bin/sh
basedir="$(dirname "$0")"
exec "$basedir/bin/pnpm" "$@"
SH
chmod 0755 "$shim_fixture/node_modules/.bin/pnpm"
shim_resolved="$(readlink -f "$shim_fixture/node_modules/.bin/pnpm")"
shim_entrypoint="$(find_pinned_pnpm_entrypoint "$shim_fixture/node_modules/.bin/pnpm")"
if [ "$shim_resolved" = "$shim_entrypoint" ] || [ "$("$shim_entrypoint" --version)" != '11.7.0' ]; then
  echo "pnpm shell-shim entrypoint regression failed" >&2
  exit 1
fi

if [ -e "$build_root" ] || mountpoint -q "$build_root"; then
  echo "refusing pre-existing fixed build root" >&2
  exit 1
fi
install -d -o root -g baci-release-build -m 0710 "$build_root"
mount -t tmpfs -o size=4g,mode=0710,gid="$(getent group baci-release-build | cut -d: -f3)" tmpfs "$build_root"
build_mounted=1
install -d -o root -g root -m 0700 "$build_root/results"

if [ -e "$cache_parent" ]; then
  echo "refusing pre-existing fixed pnpm cache directory" >&2
  exit 1
fi
install -d -o root -g root -m 0755 "$cache_parent"
cache_parent_created=1
install -d -o root -g root -m 0755 "$store_root"
store_created=1
install -d -o root -g root -m 0755 "$cache_root"
policy_cache_created=1
if [ -e "$seed_image" ] || [ -L "$seed_image" ] || [ -e "$seed_workspace" ] || \
   [ -L "$seed_workspace" ] || mountpoint -q "$seed_workspace"; then
  echo "refusing pre-existing bounded seed workspace" >&2
  exit 1
fi
if [ -e "$seed_unit_file" ] || [ -L "$seed_unit_file" ]; then
  echo "refusing pre-existing disposable seed mount unit" >&2
  exit 1
fi
PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd)${PYTHONPATH:+:$PYTHONPATH}" \
  python3 -B - <<'PY'
import sys
import os
from worker_release_seed_workspace import (
    MIN_FREE_BYTES, MIN_HOST_FREE_INODES, IMAGE, host_capacity,
)
usage = os.statvfs(IMAGE.parent.parent)
available_bytes = usage.f_bavail * usage.f_frsize
available_inodes = usage.f_favail
print(f"seed mount capacity evidence: available_bytes={available_bytes} required_bytes={MIN_FREE_BYTES} "
      f"available_inodes={available_inodes} required_inodes={MIN_HOST_FREE_INODES}")
try:
    host_capacity()
except Exception as error:
    print("disposable runner lacks capacity for the production seed mount contract", file=sys.stderr)
    raise SystemExit(1) from error
print("disposable seed mount capacity verified by production host-capacity check")
PY
python3 - "$seed_image" <<'PY'
import os, sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
os.fsync(fd)
os.close(fd)
PY
seed_image_created=1
seed_image_identity="$(stat -c '%d:%i' "$seed_image")"
python3 - "$seed_image" <<'PY'
import os, sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_NOFOLLOW)
try:
    os.posix_fallocate(fd, 0, 32 * 1024**3)
    os.fsync(fd)
    info = os.fstat(fd)
    if info.st_uid != 0 or info.st_nlink != 1 or info.st_size != 32 * 1024**3:
        raise SystemExit("temporary seed image identity or size is unsafe")
    print(f"temporary seed image identity: {info.st_dev}:{info.st_ino}")
finally:
    os.close(fd)
PY
install -d -o root -g root -m 0700 "$seed_workspace"
seed_workspace_created=1
/usr/sbin/mkfs.ext4 -F -m 0 -N 2000000 -L baci-seed-work "$seed_image" >/dev/null
seed_unit_created=1
PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd)${PYTHONPATH:+:$PYTHONPATH}" \
  python3 -B - "$seed_unit_file" <<'PY'
import os, sys
from pathlib import Path
from worker_release_seed_workspace import mount_unit_contents
path = Path(sys.argv[1])
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
try:
    payload = mount_unit_contents()
    view = memoryview(payload)
    while view:
        size = os.write(fd, view)
        if size <= 0: raise SystemExit("seed mount unit write was incomplete")
        view = view[size:]
    os.fsync(fd)
    info = os.fstat(fd)
    if info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o777 != 0o644:
        raise SystemExit("temporary seed mount unit metadata is unsafe")
    print(f"{info.st_dev}:{info.st_ino}")
finally:
    os.close(fd)
PY
seed_unit_identity="$(stat -c '%d:%i' "$seed_unit_file")"
systemctl daemon-reload
systemctl start "$seed_unit_name"
seed_workspace_mount_started=1
PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd)${PYTHONPATH:+:$PYTHONPATH}" \
SEED_TEST_IMAGE_IDENTITY="$seed_image_identity" python3 -B - <<'PY'
import os
import subprocess
from worker_release_seed_workspace_paths import ensure_seed_collection
from worker_release_seed_workspace import _verify_mount
from worker_release_seed_workspace import _secure_mounted_root
from worker_release_seed_workspace_mount import IMAGE, WORK_ROOT, UNIT_NAME, MOUNT_OPTIONS
_secure_mounted_root()
ensure_seed_collection(__import__("pathlib").Path("/var/cache/baci-worker-release/seed-work"))
for key, expected in (("What", str(IMAGE)), ("Where", str(WORK_ROOT)),
                      ("Type", "ext4"), ("Options", MOUNT_OPTIONS), ("ActiveState", "active")):
    result = subprocess.run(("/usr/bin/systemctl", "show", f"--property={key}", "--value", UNIT_NAME),
                            capture_output=True, text=True, timeout=3, check=False)
    actual = result.stdout.strip()
    print(f"seed mount {key}: " + ("match" if result.returncode == 0 and actual == expected else "mismatch"))
    if key == "Options" and actual != expected:
        for option in ("loop", "nosuid", "nodev", "noexec"):
            print(f"seed mount option {option}: " + ("present" if option in actual.split(",") else "absent"))
_verify_mount(__import__("subprocess").run,
              image_identity=tuple(map(int, os.environ["SEED_TEST_IMAGE_IDENTITY"].split(":"))))
print("temporary seed mount passed the production bounded-mount verifier")
PY
published_seed_root_created=1

