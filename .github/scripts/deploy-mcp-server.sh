#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

VPS_HOST="${MCP_VPS_HOST:?MCP_VPS_HOST is required}"
VPS_USER="${MCP_VPS_USER:?MCP_VPS_USER is required}"
REMOTE_DIR="${MCP_REMOTE_DIR:-/home/${VPS_USER}/ogabassey-mcp}"
REMOTE_ENV_FILE="${MCP_REMOTE_ENV_FILE:-${REMOTE_DIR}/.env}"
COMPOSE_PROJECT="${MCP_COMPOSE_PROJECT:-ogabassey-mcp}"
SOURCE_REF="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
DEPLOY_REF_RAW="${MCP_DEPLOY_REF:-${SOURCE_REF}-$(date -u +%Y%m%d%H%M%S)}"
DEPLOY_REF="$(printf '%s' "${DEPLOY_REF_RAW}" | tr -c 'A-Za-z0-9._-' '-')"
RELEASE_KEEP_COUNT="${MCP_RELEASE_KEEP_COUNT:-5}"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

required_paths=(
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  .npmrc
  .dockerignore
  apps/web/package.json
  apps/web/tsconfig.json
  apps/web/mcp-server
  apps/web/src
  packages/shared
)

if [ -d "${REPO_ROOT}/patches" ]; then
  required_paths+=(patches)
fi

for path in "${required_paths[@]}"; do
  if [ ! -e "${REPO_ROOT}/${path}" ]; then
    echo "Missing required deploy path: ${path}" >&2
    exit 1
  fi
done

case "${RELEASE_KEEP_COUNT}" in
  '' | *[!0-9]* | 0)
    echo "MCP_RELEASE_KEEP_COUNT must be a positive integer" >&2
    exit 1
    ;;
esac

artifact_name="mcp-server-${DEPLOY_REF}.tgz"
artifact_path="${TMP_DIR}/${artifact_name}"

COPYFILE_DISABLE=1 tar \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='.turbo' \
  --exclude='*/.turbo' \
  --exclude='apps/web/.env.local' \
  --exclude='apps/web/mcp-server/.env' \
  --exclude='apps/web/mcp-server/.env.*' \
  -czf "${artifact_path}" \
  -C "${REPO_ROOT}" \
  "${required_paths[@]}"

if [ "${MCP_DRY_RUN:-0}" = "1" ]; then
  echo "Created ${artifact_path}"
  echo "Would deploy to ${SSH_TARGET}:${REMOTE_DIR}/releases/${artifact_name}"
  tar -tzf "${artifact_path}" | sed -n '1,40p'
  exit 0
fi

ssh "${SSH_TARGET}" bash -s -- "${REMOTE_DIR}" <<'REMOTE'
set -euo pipefail
remote_dir="$1"
mkdir -p "${remote_dir}/releases"
REMOTE

rsync -a "${artifact_path}" "${SSH_TARGET}:${REMOTE_DIR}/releases/${artifact_name}"

ssh "${SSH_TARGET}" bash -s -- \
  "${REMOTE_DIR}" \
  "${REMOTE_ENV_FILE}" \
  "${DEPLOY_REF}" \
  "${artifact_name}" \
  "${COMPOSE_PROJECT}" \
  "${RELEASE_KEEP_COUNT}" <<'REMOTE'
set -euo pipefail

remote_dir="$1"
remote_env_file="$2"
deploy_ref="$3"
artifact_name="$4"
compose_project="$5"
release_keep_count="$6"
artifact_path="${remote_dir}/releases/${artifact_name}"
release_dir="${remote_dir}/releases/${deploy_ref}"
new_image_tag="${compose_project}-mcp-server:${deploy_ref}"
previous_compose_dir=""
previous_rollback_image=""
lock_file="${remote_dir}/deploy.lock"

exec 9>"${lock_file}"
flock -x 9

release_deploy_lock() {
  flock -u 9 || true
}
trap release_deploy_lock EXIT

previous_container_id="$(
  docker ps -q \
    --filter "label=com.docker.compose.project=${compose_project}" \
    --filter "label=com.docker.compose.service=mcp-server" \
    | head -n 1
)"

if [ -n "${previous_container_id}" ]; then
  previous_compose_dir="$(
    docker inspect \
      --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' \
      "${previous_container_id}" 2>/dev/null || true
  )"

  previous_image_id="$(docker inspect --format '{{ .Image }}' "${previous_container_id}" 2>/dev/null || true)"
  if [ -n "${previous_image_id}" ]; then
    previous_rollback_image="${compose_project}-mcp-server:rollback-${deploy_ref}"
    docker tag "${previous_image_id}" "${previous_rollback_image}" || previous_rollback_image=""
  fi
fi

if { [ -z "${previous_compose_dir}" ] || [ ! -f "${previous_compose_dir}/docker-compose.yml" ]; } \
  && [ -f "${remote_dir}/current/apps/web/mcp-server/docker-compose.yml" ]; then
  previous_compose_dir="${remote_dir}/current/apps/web/mcp-server"
fi

rollback_previous_deploy() {
  if [ -n "${previous_compose_dir}" ] && [ -f "${previous_compose_dir}/docker-compose.yml" ]; then
    echo "Rolling back MCP server using ${previous_compose_dir}..."
    if [ -n "${previous_rollback_image}" ]; then
      rollback_override="$(mktemp)"
      cat > "${rollback_override}" <<ROLLBACK
services:
  mcp-server:
    image: ${previous_rollback_image}
ROLLBACK
      if (cd "${previous_compose_dir}" && docker compose -p "${compose_project}" -f docker-compose.yml -f "${rollback_override}" up -d --remove-orphans); then
        rm -f "${rollback_override}"
        return
      fi

      rm -f "${rollback_override}"
      return 1
    fi

    (cd "${previous_compose_dir}" && docker compose -p "${compose_project}" up -d --remove-orphans)
    return
  fi

  echo "No previous compose release was available for automatic rollback." >&2
}

prune_old_releases() {
  ls -1dt "${remote_dir}/releases/"*/ 2>/dev/null \
    | awk -v keep="${release_keep_count}" 'NR > keep { print }' \
    | while IFS= read -r old_release; do
      old_release="${old_release%/}"
      if [ -n "${old_release}" ] && [ "${old_release}" != "${release_dir}" ]; then
        echo "Pruning old MCP release ${old_release}"
        rm -rf "${old_release}"
      fi
    done
}

if [ ! -f "${remote_env_file}" ]; then
  echo "Missing remote env file: ${remote_env_file}" >&2
  exit 1
fi

rm -rf "${release_dir}"
mkdir -p "${release_dir}"
tar -xzf "${artifact_path}" -C "${release_dir}"
rm -f "${artifact_path}"
install -m 600 "${remote_env_file}" "${release_dir}/apps/web/mcp-server/.env"

cd "${release_dir}/apps/web/mcp-server"
# This recreates the MCP container in place, so expect a brief restart window.
# The loopback health retry gates the release; use blue-green if zero downtime is required.
if ! MCP_IMAGE_TAG="${new_image_tag}" docker compose -p "${compose_project}" up -d --build --remove-orphans; then
  echo "MCP compose startup failed; attempting rollback." >&2
  rollback_previous_deploy
  exit 1
fi

health_url="http://127.0.0.1:8787/health"
health_attempts=10
health_sleep_seconds=3

for attempt in $(seq 1 "${health_attempts}"); do
  echo "MCP health check attempt ${attempt}/${health_attempts}..."

  if curl --max-time 5 --fail --silent --show-error "${health_url}"; then
    break
  fi

  if [ "${attempt}" -eq "${health_attempts}" ]; then
    echo "MCP health check failed after ${health_attempts} attempts: ${health_url}" >&2
    rollback_previous_deploy
    exit 1
  fi

  sleep "${health_sleep_seconds}"
done

ln -sfn "${release_dir}" "${remote_dir}/current"
prune_old_releases
echo "Deployed MCP server release ${deploy_ref}"
REMOTE
