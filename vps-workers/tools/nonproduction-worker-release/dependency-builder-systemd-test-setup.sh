# Sourced by dependency-builder-systemd-test.sh; keep shared setup in one process.

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
seed_workspace="$cache_parent/seed-work"
seed_image="$cache_parent/seed-work.img"
published_seed_root="$seed_workspace/seeds"
seed_unit_name='var-cache-baci\x2dworker\x2drelease-seed\x2dwork.mount'
seed_unit_file="/run/systemd/system/$seed_unit_name"
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
published_seed_root_created=0
seed_unit_created=0
seed_image_created=0
seed_workspace_created=0
seed_workspace_mount_started=0
seed_image_identity=""
seed_unit_identity=""
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
  local seed_mount_quiesced=1
  if [ "$seed_unit_created" -eq 1 ]; then
    systemctl stop "$seed_unit_name" >/dev/null 2>&1 || seed_mount_quiesced=0
    if mountpoint -q "$seed_workspace"; then
      umount "$seed_workspace" >/dev/null 2>&1 || seed_mount_quiesced=0
    fi
    if mountpoint -q "$seed_workspace"; then seed_mount_quiesced=0; fi
    seed_active_state="$(systemctl show --property=ActiveState --value "$seed_unit_name" 2>/dev/null || true)"
    case "$seed_active_state" in active|activating|deactivating|mounting|mounted) seed_mount_quiesced=0 ;; esac
    if [ -e "$seed_image" ]; then
      local attached_backing_files
      attached_backing_files="$(losetup --noheadings --raw --output BACK-FILE 2>/dev/null)" || seed_mount_quiesced=0
      if printf '%s\n' "$attached_backing_files" | grep -Fxq "$seed_image"; then
        seed_mount_quiesced=0
      fi
    fi
    local current_unit_identity
    current_unit_identity="$(stat -c '%d:%i' "$seed_unit_file" 2>/dev/null || true)"
    if [ "$seed_mount_quiesced" -eq 1 ] && [ -n "$seed_unit_identity" ] && \
       [ "$current_unit_identity" = "$seed_unit_identity" ]; then
      rm -f -- "$seed_unit_file"
      systemctl daemon-reload >/dev/null 2>&1
      seed_load_state="$(systemctl show --property=LoadState --value "$seed_unit_name" 2>/dev/null || true)"
      [ "$seed_load_state" = not-found ] || seed_mount_quiesced=0
    else
      seed_mount_quiesced=0
    fi
  fi
  [ "$helper_created" -eq 0 ] || rm -rf -- "$helper_root"
  [ "$pnpm_link_created" -eq 0 ] || rm -f /usr/bin/pnpm
  [ "$node_link_created" -eq 0 ] || rm -f /usr/bin/node
  [ "$build_mounted" -eq 0 ] || umount "$build_root"
  [ "$store_created" -eq 0 ] || rm -rf -- "$store_root"
  [ "$policy_cache_created" -eq 0 ] || rm -rf -- "$cache_root"
  if [ "$seed_mount_quiesced" -eq 1 ] && [ "$published_seed_root_created" -eq 1 ]; then
    rm -rf -- "$published_seed_root"
  fi
  if [ "$seed_mount_quiesced" -eq 1 ] && [ "$seed_workspace_created" -eq 1 ]; then
    rmdir "$seed_workspace" >/dev/null 2>&1
  fi
  if [ "$seed_mount_quiesced" -eq 1 ] && [ "$seed_image_created" -eq 1 ]; then
    local current_image_identity
    current_image_identity="$(stat -c '%d:%i' "$seed_image" 2>/dev/null || true)"
    if [ -n "$seed_image_identity" ] && [ "$current_image_identity" = "$seed_image_identity" ]; then
      rm -f -- "$seed_image"
    fi
  fi
  [ "$cache_parent_created" -eq 0 ] || rmdir "$cache_parent" 2>/dev/null
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

builder_uid="$(id -u baci-release-build)"
worker_gid="$(getent group baci-worker | cut -d: -f3)"
lock_gid="$(getent group baci-locks | cut -d: -f3)"
for identity_value in "$builder_uid" "$worker_gid" "$lock_gid"; do
  if [[ ! "$identity_value" =~ ^[0-9]+$ ]] || [ "$identity_value" -eq 0 ]; then
    echo "disposable identity lookup did not return a nonzero numeric ID" >&2
    exit 1
  fi
done

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

source "$script_dir/dependency-builder-systemd-test-setup-seed-mount.sh"

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
chown root:baci-worker "$release_root" "$release_root/apps" "$release_root/apps/web"
chmod 0750 "$release_root" "$release_root/apps" "$release_root/apps/web"
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
{"name":"baci-vps-workers-fixture","version":"1.0.0","private":true,"packageManager":"pnpm@11.7.0","dependencies":{"@supabase/supabase-js":"2.104.0","dotenv":"16.6.1","expo-server-sdk":"6.1.0"}}
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
