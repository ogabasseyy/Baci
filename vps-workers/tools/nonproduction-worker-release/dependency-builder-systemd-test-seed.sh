# Sourced by dependency-builder-systemd-test.sh; keep shared setup in one process.

/usr/bin/node "$pnpm_entrypoint" --version | grep -Fx '11.7.0'
# Match real tracked locks, which omit settings.injectWorkspacePackages and
# therefore use pnpm's false default. Frozen installs follow those lockfiles;
# only the modern deploy command enables injection.
(cd "$source_root" && PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES=false pnpm install --lockfile-only --ignore-scripts)
(cd "$source_root/vps-workers" && PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES=false pnpm install --lockfile-only --ignore-scripts)
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
  worker_release_dependency_source.py worker_release_dependency_receipt_validation.py \
  worker_release_dependency_fs.py worker_release_dependency_sandbox.py \
  worker_release_dependency_policy_cache.py worker_release_dependency_registry_policy.py \
  worker_release_dependency_lock_settings.py \
  worker_release_dependency_input_cache.py worker_release_dependency_diagnostics.py \
  worker_release_bounded_process.py worker_release_pnpm_exec.py \
  worker_release_dependency_evidence_shape.py \
  worker_release_dependency_policy_cli.py; do
  install -o root -g root -m 0444 "$(dirname "$0")/../../bin/$module" "$helper_root/$module"
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
