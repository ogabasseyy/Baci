#!/usr/bin/env bash
# One-time, idempotent host setup for isolated worker releases. Run as root:
#   bash vps-workers/release/provision-host.sh          # apply
#   bash vps-workers/release/provision-host.sh --check  # read-only readiness
#
# Creates the unprivileged `baci-worker` user (no sudo, no docker), lets the
# deploy user switch to it (never the reverse), and migrates the legacy
# worker environment without deployment or administration credentials.
set -euo pipefail

WORKER_USER="${BACI_WORKER_USER:-baci-worker}"
DEPLOY_USER="${BACI_DEPLOY_USER:-bassey}"
ROOT="${BACI_WORKER_ROOT:-/srv/baci-worker}"
LEGACY_DIR="${BACI_LEGACY_WORKER_DIR:-/home/$DEPLOY_USER/baci-workers}"
LEGACY_APP_LIVE="${BACI_LEGACY_APP_LIVE:-/home/$DEPLOY_USER/app-live}"
SUDOERS_FILE="${BACI_WORKER_SUDOERS_FILE:-/etc/sudoers.d/baci-worker}"
WORKERS="$ROOT/baci-workers"
# Read by no scheduled worker: GitHub, Supabase management, Vercel OIDC and
# Sentry admin tokens, plus Docker-only remediation settings.
# Key recognition mirrors dotenv: optional export, spaces around `=`, or `:`.
DOTENV_KEY_PATTERN='^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_.-]+)[[:space:]]*(=|:[[:space:]])'
DROPPED_KEY_PATTERN='^(GITHUB_PERSONAL_ACCESS_TOKEN|GH_TOKEN|GITHUB_TOKEN|GH_BIN|SUPABASE_ACCESS_TOKEN|VERCEL_OIDC_TOKEN|VERCEL_TOKEN|VERCEL_BIN|SENTRY_AUTH_TOKEN|SENTRY_REMEDIATION_AUTH_TOKEN|CODEX_BIN|AUTONOMA_CLIENT_ID|AUTONOMA_SECRET_ID|BACI_REMEDIATION_[A-Z0-9_]*)$'

fail() {
  echo "provision-host: $*" >&2
  exit 1
}

# Prints the worker environment: dropped keys removed, legacy paths moved.
# Values are never printed elsewhere; only key names appear in errors.
migrate_env() {
  local line key output=''
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ $DOTENV_KEY_PATTERN ]]; then
      key="${BASH_REMATCH[2]}"
      if [[ "$key" =~ $DROPPED_KEY_PATTERN ]]; then continue; fi
      # Checkout paths first: the nested legacy app-live would otherwise be
      # rewritten into the worker directory instead of the release symlink.
      line="${line//$LEGACY_DIR\/app-live/$ROOT/app-live}"
      line="${line//$LEGACY_APP_LIVE/$ROOT/app-live}"
      line="${line//$LEGACY_DIR/$WORKERS}"
      if [[ "$line" == *"/home/$DEPLOY_USER"* ]]; then
        fail "worker setting $key still points into /home/$DEPLOY_USER; move it before provisioning."
      fi
    fi
    output+="$line"$'\n'
  done < "$1"
  # Emit nothing unless the whole file migrates.
  printf '%s' "$output"
}

has_dropped_key() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ $DOTENV_KEY_PATTERN ]] && [[ "${BASH_REMATCH[2]}" =~ $DROPPED_KEY_PATTERN ]]; then
      return 0
    fi
  done < "$1"
  return 1
}

check() {
  local problems=0 uid
  report() { echo "NOT READY: $*"; problems=$((problems + 1)); }
  if uid="$(id -u "$WORKER_USER" 2>/dev/null)"; then
    id -nG "$WORKER_USER" | tr ' ' '\n' | grep -qx -E 'sudo|docker|adm|wheel' &&
      report "$WORKER_USER belongs to a privileged group."
    [ -d "/run/user/$uid" ] || [ -f "/var/lib/systemd/linger/$WORKER_USER" ] ||
      report "lingering is not enabled for $WORKER_USER."
  else
    report "user $WORKER_USER does not exist."
  fi
  [ -f "$SUDOERS_FILE" ] || report "$SUDOERS_FILE is missing."
  [ -f "$WORKERS/.env" ] || report "$WORKERS/.env is missing."
  if [ -f "$WORKERS/.env" ] && has_dropped_key "$WORKERS/.env"; then
    report "$WORKERS/.env still contains deployment or administration credentials."
  fi
  command -v setfacl >/dev/null || report "setfacl is not installed (package: acl)."
  for tool in git node pnpm flock crontab; do
    command -v "$tool" >/dev/null || report "$tool is not installed system-wide."
  done
  [ "$(df -Pk "$(dirname "$ROOT")" | awk 'NR==2 {print $4}')" -ge 10485760 ] ||
    report "less than 10 GiB is free for worker releases."
  if [ "$problems" -eq 0 ]; then echo "READY: host is provisioned for isolated worker releases."; fi
  return "$problems"
}

apply() {
  [ "$(id -u)" -eq 0 ] || fail "run as root (or use --check)."
  id -u "$DEPLOY_USER" >/dev/null || fail "deploy user $DEPLOY_USER does not exist."
  [ -f "$LEGACY_DIR/.env" ] || [ -f "$WORKERS/.env" ] || fail "no worker environment to migrate."

  if ! id -u "$WORKER_USER" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$ROOT" --create-home --shell /bin/bash "$WORKER_USER"
  fi
  passwd -l "$WORKER_USER" >/dev/null
  loginctl enable-linger "$WORKER_USER"

  install -d -o "$WORKER_USER" -g "$WORKER_USER" -m 0750 "$ROOT"
  for dir in "$WORKERS" "$WORKERS/logs" "$WORKERS/locks" "$WORKERS/state"; do
    install -d -o "$WORKER_USER" -g "$WORKER_USER" -m 0750 "$dir"
  done

  if [ ! -f "$WORKERS/.env" ]; then
    local tmp
    tmp="$(mktemp "$WORKERS/.env.XXXXXX")"
    migrate_env "$LEGACY_DIR/.env" > "$tmp" || { rm -f "$tmp"; exit 1; }
    chown "$WORKER_USER:$WORKER_USER" "$tmp"
    chmod 0640 "$tmp"
    mv -f "$tmp" "$WORKERS/.env"
    if [ -d "$LEGACY_DIR/state" ]; then
      cp -a --no-clobber "$LEGACY_DIR/state/." "$WORKERS/state/"
    fi
    if [ -f "$LEGACY_DIR/.gigl-capability-smoke-ok" ]; then
      install -o "$WORKER_USER" -g "$WORKER_USER" -m 0640 \
        "$LEGACY_DIR/.gigl-capability-smoke-ok" "$WORKERS/.gigl-capability-smoke-ok"
    fi
    chown -R "$WORKER_USER:$WORKER_USER" "$WORKERS/state"
  fi

  # The deploy user reads install state and the latch; it never needs write.
  setfacl -R -m "u:$DEPLOY_USER:rX" "$ROOT"
  setfacl -R -d -m "u:$DEPLOY_USER:rX" "$ROOT"

  local sudoers_tmp
  sudoers_tmp="$(mktemp)"
  printf '%s ALL=(%s) NOPASSWD: ALL\n' "$DEPLOY_USER" "$WORKER_USER" > "$sudoers_tmp"
  visudo -cqf "$sudoers_tmp" || { rm -f "$sudoers_tmp"; fail "generated sudoers entry is invalid."; }
  install -o root -g root -m 0440 "$sudoers_tmp" "$SUDOERS_FILE"
  rm -f "$sudoers_tmp"
  check
}

main() {
  case "${1:-}" in
    --check) check ;;
    '') apply ;;
    *) fail "usage: provision-host.sh [--check]" ;;
  esac
}

# Sourcing (tests) exposes the functions without provisioning anything.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
