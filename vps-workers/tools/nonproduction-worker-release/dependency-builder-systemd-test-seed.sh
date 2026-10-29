# Sourced by dependency-builder-systemd-test.sh; keep shared setup in one process.

/usr/bin/node "$pnpm_entrypoint" --version | grep -Fx '11.7.0'
# Match real tracked locks, which omit settings.injectWorkspacePackages and
# therefore use pnpm's false default. Frozen installs follow those lockfiles;
# only the modern deploy command enables injection.
(cd "$source_root" && PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES=false pnpm install --lockfile-only --ignore-scripts)
(cd "$source_root/vps-workers" && PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES=false pnpm install --lockfile-only --ignore-scripts)

# The source snapshot is the authenticated workspace, not pnpm's mutable
# install workspace. lockfile-only can still leave node_modules metadata behind;
# its symlinks are intentionally forbidden by the immutable source validator.
# Put an explicit generated symlink in that location so this fixture keeps
# exercising the cleanup contract even when a pnpm version leaves no metadata.
mkdir -p -- "$source_root/node_modules/.bin"
ln -s -- "$test_root" "$source_root/node_modules/.bin/generated-fixture-entry"
find "$source_root" -name node_modules -prune -exec rm -rf -- {} +
if find "$source_root" -name node_modules -print -quit | grep -q .; then
  echo "generated pnpm install metadata remains in synthetic source snapshot" >&2
  exit 1
fi
cp -a "$source_root/." "$seed_root/"
if find "$seed_root" -name node_modules -print -quit | grep -q .; then
  echo "synthetic immutable source snapshot contains generated pnpm metadata" >&2
  exit 1
fi
python3 "$(dirname "$0")/../../bin/worker_release_dependency_policy_cache.py" \
  --preverify --source "$seed_root" --store "$store_root" --cache "$cache_root" \
  --pnpm "$pnpm_entrypoint" --node /usr/bin/node
chown -R root:root "$source_root"
find "$source_root" -type d -exec chmod 0550 {} +
find "$source_root" -type f -exec chmod 0440 {} +
chown -R root:root "$seed_root"
find "$seed_root" -type d -exec chmod 0550 {} +
find "$seed_root" -type f -exec chmod 0440 {} +

mkdir -m 0700 -- "$published_seed_root"
published_seed_root_created=1
PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd):$(cd "$(dirname "$0")" && pwd)" \
  python3 - "$seed_root" "$cache_root" "$store_root" "$published_seed_root" "$sha" <<'PY'
import json, sys
from pathlib import Path
from dependency_seed_publisher import publish_seed
from worker_release_dependency_policy_cache import RECEIPT_NAME

source, cache, store, seeds = map(Path, sys.argv[1:5])
sha = sys.argv[5]
receipt = json.loads((store / RECEIPT_NAME).read_text(encoding="utf-8"))
published = publish_seed(source, cache, store, seeds, sha, verified_receipt=receipt)
print(f"synthetic immutable dependency seed published for exact SHA; present={published.is_dir()}")
PY
PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd):$(cd "$(dirname "$0")" && pwd)" \
  python3 - "$source_root" "$published_seed_root" "$sha" <<'PY'
import sys
from pathlib import Path
from dependency_seed_publisher import verify_seed

source, seeds, sha = map(Path, sys.argv[1:3])
sha_value = sys.argv[3]
verify_seed(seeds / sha_value, source, authenticated_source_sha=sha_value)
print("synthetic exact per-SHA seed verified against the builder source")
PY
rm -rf -- "$seed_root" "$store_root" "$cache_root"
store_created=0
policy_cache_created=0

if [ -e "$helper_root" ] || [ -L "$helper_root" ]; then
  echo "refusing pre-existing helper directory" >&2
  exit 1
fi
mkdir -m 0755 -- "$helper_root"
helper_created=1
chown root:root "$helper_root"
for module in worker_release_dependency_builder.py worker_release_dependency_artifacts.py \
  worker_release_dependency_source.py worker_release_dependency_receipt_validation.py \
  worker_release_dependency_fs.py worker_release_dependency_sandbox.py \
  worker_release_dependency_seed_consumer.py \
  worker_release_dependency_policy_cache.py worker_release_dependency_registry_policy.py \
  worker_release_dependency_lock_settings.py \
  worker_release_dependency_input_cache.py worker_release_dependency_diagnostics.py \
  worker_release_bounded_process.py worker_release_pnpm_exec.py \
  worker_release_dependency_evidence_shape.py \
  worker_release_dependency_policy_cli.py; do
  install -o root -g root -m 0444 "$(dirname "$0")/../../bin/$module" "$helper_root/$module"
done
for module in dependency_seed_filesystem dependency_seed_receipts dependency_seed_source \
  dependency_seed_transaction dependency_seed_tree dependency_seed_verification; do
  install -o root -g root -m 0444 "$(dirname "$0")/${module}.py" "$helper_root/${module}.py"
done
install -o root -g root -m 0555 "$(dirname "$0")/dependency-snapshot-smoke.py" \
  "$helper_root/dependency-snapshot-smoke.py"
install -o root -g root -m 0444 "$(dirname "$0")/dependency-builder-fixture-pnpm.py" \
  "$helper_root/dependency-builder-fixture-pnpm.py"
for module in dependency_builder_fixture_pnpm_classification.py \
  dependency_builder_fixture_pnpm_diagnostics.py; do
  install -o root -g root -m 0444 "$(dirname "$0")/$module" "$helper_root/$module"
done
python3 "$(dirname "$0")/dependency-builder-fixture-pnpm.test.py"

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
exec /usr/bin/python3 "$helper_root/dependency-builder-fixture-pnpm.py" \
  "$helper_root/pnpm/bin/pnpm.cjs" "\$@"
EOF
chown root:root /usr/bin/pnpm
chmod 0555 /usr/bin/pnpm
pnpm_link_created=1

PYTHONPATH="$(cd "$(dirname "$0")/../../bin" && pwd):$(cd "$(dirname "$0")" && pwd)"
export PYTHONPATH
python3 - <<'PY'
from worker_release_dependency_seed_consumer import SEED_ROOT
from pathlib import Path
seed = SEED_ROOT / "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if not seed.is_dir() or seed.is_symlink():
    raise SystemExit("exact synthetic dependency seed is unavailable")
if Path("/var/cache/baci-worker-release/pnpm-store").exists():
    raise SystemExit("legacy global store unexpectedly remains available")
print("synthetic exact per-SHA seed is the only builder input source")
PY
builder_unit="baci-worker-deps-${sha:0:12}-${suffix}.service"
unit_load_state="$(systemctl show -p LoadState --value "$builder_unit" 2>/dev/null || true)"
if [ -n "$unit_load_state" ] && [ "$unit_load_state" != not-found ]; then
  echo "refusing pre-existing builder transient unit" >&2
  exit 1
fi
builder_unit_owned=1
