#!/usr/bin/env bash
# Disposable Linux/systemd test of the real dependency builder and snapshot smoke.
set -euo pipefail

if [ "$(id -u)" -ne 0 ] || [ "$(ps -p 1 -o comm= | tr -d ' ')" != systemd ]; then
  echo "dependency builder test requires root on a disposable systemd VM" >&2
  exit 77
fi

suffix="$(python3 -c 'import secrets; print(secrets.token_hex(5))')"
test_root="$(mktemp -d "/run/baci-dependency-test-${suffix}.XXXXXX")"
chmod 0711 "$test_root"
helper_root="/usr/local/lib/baci-dependency-test-${suffix}"
build_root=/run/baci-worker-release-build
store_root=/var/cache/baci-worker-release/pnpm-store
cache_root=/var/cache/baci-worker-release/pnpm-cache
cache_parent=/var/cache/baci-worker-release
test_unit="baci-dependency-snapshot-${suffix}.service"
lock_group_created=0
builder_group_created=0
builder_user_created=0
worker_group_created=0
worker_user_created=0
build_mounted=0
store_created=0
cache_parent_created=0
policy_cache_created=0
helper_created=0
builder_unit_owned=0
test_unit_owned=0
node_link_created=0
pnpm_link_created=0
srv_created=0
srv_worker_root_created=0
srv_runtime_created=0
srv_releases_created=0
srv_locks_created=0

find_pinned_pnpm_entrypoint() {
  local launcher="$1" bin_dir install_root candidate
  local -a pnpm_candidates=()
  bin_dir="$(dirname "$launcher")"
  install_root="$(cd "$bin_dir/.." && pwd -P)"
  while IFS= read -r -d '' candidate; do
    if [ "$(/usr/bin/node "$candidate" --version 2>/dev/null || true)" = '11.7.0' ]; then
      pnpm_candidates+=("$candidate")
    fi
  done < <(find "$install_root" -type f -path '*/pnpm/bin/pnpm.cjs' -print0)
  if [ "${#pnpm_candidates[@]}" -ne 1 ]; then
    echo "could not locate one pinned pnpm package under ${install_root}" >&2
    return 1
  fi
  printf '%s\n' "${pnpm_candidates[0]}"
}

cleanup() {
  local status=$?
  set +e
  [ "$test_unit_owned" -eq 0 ] || systemctl stop "$test_unit" >/dev/null 2>&1
  [ "$builder_unit_owned" -eq 0 ] || systemctl stop "$builder_unit" >/dev/null 2>&1
  [ "$helper_created" -eq 0 ] || rm -rf -- "$helper_root"
  [ "$pnpm_link_created" -eq 0 ] || rm -f /usr/bin/pnpm
  [ "$node_link_created" -eq 0 ] || rm -f /usr/bin/node
  [ "$build_mounted" -eq 0 ] || umount "$build_root"
  [ "$store_created" -eq 0 ] || rm -rf -- "$store_root"
  [ "$policy_cache_created" -eq 0 ] || rm -rf -- "$cache_root"
  [ "$cache_parent_created" -eq 0 ] || rmdir "$cache_parent"
  [ "$worker_user_created" -eq 0 ] || userdel baci-worker >/dev/null 2>&1
  [ "$worker_group_created" -eq 0 ] || groupdel baci-worker >/dev/null 2>&1
  [ "$builder_user_created" -eq 0 ] || userdel baci-release-build >/dev/null 2>&1
  [ "$builder_group_created" -eq 0 ] || groupdel baci-release-build >/dev/null 2>&1
  [ "$lock_group_created" -eq 0 ] || groupdel baci-locks >/dev/null 2>&1
  [ "$srv_locks_created" -eq 0 ] || rmdir /srv/baci-workers/locks >/dev/null 2>&1
  [ "$srv_releases_created" -eq 0 ] || rmdir /srv/baci-workers/releases >/dev/null 2>&1
  [ "$srv_runtime_created" -eq 0 ] || rmdir /srv/baci-workers/runtime >/dev/null 2>&1
  [ "$srv_worker_root_created" -eq 0 ] || rmdir /srv/baci-workers >/dev/null 2>&1
  [ "$srv_created" -eq 0 ] || rmdir /srv >/dev/null 2>&1
  rm -rf -- "$test_root"
  exit "$status"
}
trap cleanup EXIT

for identity in baci-locks baci-release-build baci-worker; do
  if getent group "$identity" >/dev/null || getent passwd "$identity" >/dev/null; then
    echo "refusing pre-existing disposable identity: ${identity}" >&2
    exit 1
  fi
done
groupadd --system baci-locks
lock_group_created=1
groupadd --system baci-release-build
builder_group_created=1
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid baci-release-build baci-release-build
builder_user_created=1
groupadd --system baci-worker
worker_group_created=1
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid baci-worker --groups baci-locks baci-worker
worker_user_created=1

if ! command -v node >/dev/null; then
  echo "Node is unavailable on the disposable runner" >&2
  exit 1
fi
case "$(node --version)" in
  v24.*) ;;
  *) echo "fixture requires the workflow-pinned Node 24 runtime" >&2; exit 1 ;;
esac
if [ ! -x /usr/bin/node ]; then
  ln -s "$(command -v node)" /usr/bin/node
  node_link_created=1
elif [ "$(/usr/bin/node --version)" != "$(node --version)" ]; then
  echo "fixed /usr/bin/node does not match the workflow-pinned runtime" >&2
  exit 1
fi

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

if [ -e /srv/baci-workers ] || [ -e /srv ]; then
  if [ ! -d /srv ] || [ -e /srv/baci-workers ]; then
    echo "refusing pre-existing worker runtime paths on disposable VM" >&2
    exit 1
  fi
else
  install -d -o root -g root -m 0755 /srv
  srv_created=1
fi
install -d -o root -g root -m 0755 /srv/baci-workers
srv_worker_root_created=1
install -d -o root -g root -m 0700 /srv/baci-workers/runtime
srv_runtime_created=1
install -d -o root -g root -m 0700 /srv/baci-workers/releases
srv_releases_created=1
install -d -o root -g root -m 0700 /srv/baci-workers/locks
srv_locks_created=1

source_root="$test_root/source"
seed_root="$test_root/store-seed"
release_root="$test_root/release"
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
install -d -o root -g root -m 0700 "$source_root/apps/web" "$source_root/vps-workers" \
  "$seed_root" "$release_root/apps/web"
chmod 0755 "$release_root" "$release_root/apps" "$release_root/apps/web"
cat >"$source_root/package.json" <<'JSON'
{"name":"dependency-build-fixture","private":true,"packageManager":"pnpm@11.7.0"}
JSON
cat >"$source_root/pnpm-workspace.yaml" <<'YAML'
packages:
  - apps/web
minimumReleaseAge: 1440
trustPolicy: no-downgrade
trustLockfile: true
YAML
cat >"$source_root/apps/web/package.json" <<'JSON'
{"name":"@baci/web","version":"1.0.0","dependencies":{"tsx":"4.22.4"}}
JSON
cat >"$source_root/vps-workers/package.json" <<'JSON'
{"name":"baci-vps-workers-fixture","version":"1.0.0","private":true,"packageManager":"pnpm@11.7.0","dependencies":{"dotenv":"16.6.1"}}
JSON
cat >"$source_root/vps-workers/pnpm-workspace.yaml" <<'YAML'
packages:
  - .
minimumReleaseAge: 1440
trustPolicy: no-downgrade
trustLockfile: true
YAML
printf '%s\n' "$sha" >"$source_root/.baci-source-sha"

pnpm_launcher="$(command -v pnpm)"
pnpm_entrypoint="$(find_pinned_pnpm_entrypoint "$pnpm_launcher")"
if [ ! -f "$pnpm_entrypoint" ] || [ -L "$pnpm_entrypoint" ] || \
   [ "$(/usr/bin/node "$pnpm_entrypoint" --version 2>/dev/null || true)" != '11.7.0' ]; then
  echo "pinned pnpm entrypoint is unavailable under the workflow Node runtime: $pnpm_entrypoint" >&2
  exit 1
fi
/usr/bin/node "$pnpm_entrypoint" --version | grep -Fx '11.7.0'
(cd "$source_root" && pnpm install --lockfile-only --ignore-scripts)
(cd "$source_root/vps-workers" && pnpm install --lockfile-only --ignore-scripts)
cp -a "$source_root/." "$seed_root/"
python3 "$(dirname "$0")/../../bin/worker_release_dependency_policy_cache.py" \
  --preverify --source "$seed_root" --store "$store_root" --cache "$cache_root" \
  --pnpm "$pnpm_entrypoint" --node /usr/bin/node
rm -rf -- "$seed_root"
chown -R root:root "$source_root"
find "$source_root" -type d -exec chmod 0550 {} +
find "$source_root" -type f -exec chmod 0440 {} +

chown -R root:root "$store_root"
chmod -R a-w "$store_root"
chown -R root:root "$cache_root"
chmod -R a-w "$cache_root"

if [ -e "$helper_root" ] || [ -L "$helper_root" ]; then
  echo "refusing pre-existing helper directory" >&2
  exit 1
fi
mkdir -m 0755 -- "$helper_root"
helper_created=1
chown root:root "$helper_root"
for module in worker_release_dependency_builder.py worker_release_dependency_artifacts.py \
  worker_release_dependency_fs.py worker_release_dependency_sandbox.py \
  worker_release_dependency_policy_cache.py worker_release_dependency_registry_policy.py \
  worker_release_dependency_input_cache.py; do
  install -o root -g root -m 0444 "$(dirname "$0")/../../bin/$module" "$helper_root/$module"
done
install -o root -g root -m 0555 "$(dirname "$0")/dependency-snapshot-smoke.py" \
  "$helper_root/dependency-snapshot-smoke.py"

# The action installs pnpm under the runner's home directory. That path is
# intentionally hidden from the transient service by ProtectHome=true, so
# stage the exact pinned package and use a system-visible wrapper.
if [ -e /usr/bin/pnpm ] || [ -L /usr/bin/pnpm ]; then
  echo "refusing pre-existing /usr/bin/pnpm on disposable runner" >&2
  exit 1
fi
pnpm_package_root="${pnpm_entrypoint%/bin/pnpm.cjs}"
if [ ! -d "$pnpm_package_root" ] || [ ! -f "$pnpm_entrypoint" ] || [ -L "$pnpm_entrypoint" ]; then
  echo "workflow pnpm package is unavailable" >&2
  exit 1
fi
cp -a -- "$pnpm_package_root" "$helper_root/pnpm"
chown -R root:root "$helper_root/pnpm"
find "$helper_root/pnpm" -type d -exec chmod 0555 {} +
find "$helper_root/pnpm" -type f -exec chmod 0444 {} +
while IFS= read -r -d '' link; do
  target="$(readlink -f "$link")" || {
    echo "staged pnpm package contains a broken link" >&2
    exit 1
  }
  case "$target" in
    "$helper_root/pnpm"/*) ;;
    *) echo "staged pnpm package contains an external link" >&2; exit 1 ;;
  esac
done < <(find "$helper_root/pnpm" -type l -print0)
if [ "$(/usr/bin/node "$helper_root/pnpm/bin/pnpm.cjs" --version)" != '11.7.0' ]; then
  echo "staged pnpm package does not match the workflow version pin" >&2
  exit 1
fi
cat >/usr/bin/pnpm <<EOF
#!/bin/sh
exec /usr/bin/node "$helper_root/pnpm/bin/pnpm.cjs" "\$@"
EOF
chown root:root /usr/bin/pnpm
chmod 0555 /usr/bin/pnpm
pnpm_link_created=1

PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd)"
export PYTHONPATH
python3 - <<'PY'
from worker_release_dependency_builder import _validate_offline_store
_, excluded = _validate_offline_store()
print(f"synthetic pnpm store validated; transient project indexes excluded: {len(excluded)}")
PY
builder_unit="baci-worker-deps-${sha:0:12}-${suffix}.service"
unit_load_state="$(systemctl show -p LoadState --value "$builder_unit" 2>/dev/null || true)"
if [ -n "$unit_load_state" ] && [ "$unit_load_state" != not-found ]; then
  echo "refusing pre-existing builder transient unit" >&2
  exit 1
fi
builder_unit_owned=1
python3 - "$source_root" "$release_root" "$sha" "$suffix" "$helper_root" <<'PY'
import os, re, subprocess, sys, time
from pathlib import Path
from types import SimpleNamespace
import worker_release_dependency_builder as dependency_builder
from worker_release_dependency_consumer import _verify_candidate
from worker_release_dependency_install import install_payload

source, release, sha = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
helper_root = Path(sys.argv[5])
from worker_release_dependency_builder import uuid
uuid.uuid4 = lambda: SimpleNamespace(hex=sys.argv[4])

def run_fixture_sandbox(command, scratch, unit, *, usage_root=None):
    # The production helper intentionally discards child output. This fixture
    # has only synthetic inputs and no secrets, so capture a small, redacted
    # diagnostic from its exact transient unit when it fails.
    # The checkout lives below /home/runner, which the test service correctly
    # cannot traverse with ProtectHome=true. Execute the same copied module
    # set from the root-owned, world-readable fixture directory instead.
    fixture_command = tuple(
        str(helper_root / "worker_release_dependency_builder.py")
        if argument == str(Path(dependency_builder.__file__))
        else argument
        for argument in command
    )
    if usage_root is None or Path(usage_root) != dependency_builder.BUILD_ROOT:
        raise RuntimeError("dependency builder did not forward the fixed build usage root")
    bounded_root = Path(usage_root)
    deadline = time.monotonic() + dependency_builder.MAX_BUILD_SECONDS + 15
    process = subprocess.Popen(
        fixture_command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={"PATH": "/usr/bin:/bin"},
        text=True,
        errors="replace",
    )
    try:
        while process.poll() is None:
            dependency_builder.directory_usage(
                bounded_root,
                max_entries=dependency_builder.MAX_BUILD_SCRATCH_ENTRIES,
                max_bytes=dependency_builder.MAX_BUILD_SCRATCH_BYTES,
            )
            if time.monotonic() >= deadline:
                subprocess.run(("/usr/bin/systemctl", "kill", "--kill-whom=all", "--signal=SIGKILL", unit),
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10, check=False)
                raise subprocess.TimeoutExpired(fixture_command, dependency_builder.MAX_BUILD_SECONDS + 15)
            time.sleep(0.25)
        stdout, stderr = process.communicate()
    except BaseException:
        if process.poll() is None:
            subprocess.run(("/usr/bin/systemctl", "kill", "--kill-whom=all", "--signal=SIGKILL", unit),
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10, check=False)
            process.wait(timeout=15)
        raise
    result = subprocess.CompletedProcess(fixture_command, process.returncode, stdout, stderr)
    if result.returncode == 0:
        return
    diagnostic = (result.stderr + "\n" + result.stdout)[-4096:]
    for pattern, replacement in (
        (r"(?i)(bearer\s+)[^\s,;]+", r"\1[redacted]"),
        (r"(?i)((?:access[_-]?token|refresh[_-]?token|password|secret)=)[^\s,;]+", r"\1[redacted]"),
        (r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b", "[redacted]"),
        (r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", "[redacted]"),
    ):
        diagnostic = re.sub(pattern, replacement, diagnostic)
    print(f"dependency fixture transient unit failed: {unit} (exit {result.returncode})", file=sys.stderr)
    if diagnostic.strip():
        print(diagnostic, file=sys.stderr)
    raise subprocess.CalledProcessError(result.returncode, fixture_command)

dependency_builder.run_sandbox = run_fixture_sandbox
manifest, result_dir = dependency_builder.build(str(source), sha)
payload = _verify_candidate(manifest, result_dir, source, sha, os.geteuid())
install_payload(payload, release, owner_uid=os.geteuid())
print("dependency candidate materialized")
PY

smoke_output="$test_root/smoke.json"
unit_load_state="$(systemctl show -p LoadState --value "$test_unit" 2>/dev/null || true)"
if [ -n "$unit_load_state" ] && [ "$unit_load_state" != not-found ]; then
  echo "refusing pre-existing smoke transient unit" >&2
  exit 1
fi
test_unit_owned=1
systemd-run --quiet --system --wait --pipe --collect --unit="$test_unit" \
  --uid="$(id -u baci-release-build)" --gid="$(id -g baci-release-build)" \
  --property=ProtectSystem=strict --property=ProtectHome=true --property=PrivateTmp=true \
  --property=PrivateDevices=true --property=PrivateNetwork=true --property=NoNewPrivileges=true \
  --property=PrivateUsers=true --property=RestrictSUIDSGID=true --property=LockPersonality=true \
  --property=KillMode=control-group --property=RuntimeMaxSec=45s \
  --property=MemoryMax=1G --property=CPUQuota=100% --property=TasksMax=64 \
  --property=LimitFSIZE=1073741824 --property=LimitNOFILE=4096 \
  --property="ReadOnlyPaths=$release_root" \
  --property="InaccessiblePaths=/srv/baci-workers/runtime /srv/baci-workers/releases /srv/baci-workers/locks" \
  --setenv=PATH=/usr/bin:/bin --setenv=HOME=/nonexistent --setenv=NODE_ENV=production \
  /usr/bin/python3 "$helper_root/dependency-snapshot-smoke.py" "$release_root" >"$smoke_output"
python3 - "$smoke_output" <<'PY'
import json, sys
from pathlib import Path
result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert result == {"snapshot_sha256": result["snapshot_sha256"], "tsx": "passed", "dotenv": "passed"}
assert len(result["snapshot_sha256"]) == 64
print("independent materialized-snapshot smoke passed")
PY
