# shellcheck shell=bash
# Scopes the GIGL tracking/smoke process environment to an allowlist.
# Source it from the GIGL cron entries BEFORE delegating to
# run-web-script.sh; do not execute. Usage:
#   . "$SCRIPT_DIR/gigl-tracking-scoped-env.sh"
#   gigl_tracking_scope_env
#
# The shared worker .env holds every worker's secrets (SUPABASE_SERVICE_ROLE_KEY,
# petrock/jumia/quiz credentials, encryption keys...). The provider-facing GIGL
# poller must never see them: code execution in that process would bypass all
# five wrapper restrictions. This filter exports ONLY the GIGL allowlist below,
# then points BACI_WORKER_ENV at /dev/null so dotenv/config loads nothing
# further. Caller-exported variables (NODE_ENV, BACI_WORKER_PROFILE, PATH,
# ...) pass through untouched, and a caller-set value wins over the file
# (exact dotenv precedence).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo 'gigl-tracking-scoped-env.sh must be sourced, not executed' >&2
  exit 2
fi

gigl_tracking_scope_env() {
  local shared_env="${BACI_WORKER_ENV:-$HOME/baci-workers/.env}"
  local filter_dir key candidate
  filter_dir="$(unset CDPATH; cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  # The reader is copied next to this filter by prepare-worker-release.sh
  # (single source: .github/scripts/gigl-dotenv.sh), so the poller and the
  # CI gates can never disagree on export/quote/comment forms.
  # shellcheck disable=SC1091
  . "$filter_dir/gigl-dotenv.sh"

  if [ ! -f "$shared_env" ]; then
    echo "[gigl-tracking-env] Missing shared worker env file: $shared_env" >&2
    return 1
  fi

  gigl_tracking_export_from_file() {
    local export_key="$1" export_value
    # A set process variable wins even when empty (exact dotenv
    # precedence); printenv exits 0 for set-but-empty on coreutils/BSD.
    if printenv "$export_key" >/dev/null 2>&1; then
      return 0
    fi
    export_value="$(gigl_dotenv_value "$shared_env" "$export_key")"
    if [ -n "$export_value" ]; then
      export "$export_key=$export_value"
    fi
  }

  # Non-secret infrastructure the entries need: Supabase coordinates for
  # the scoped client, and the checkout path for run-web-script.sh (which
  # otherwise re-reads it from the env file this filter unpoints below).
  for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY BACI_REPO_DIR; do
    gigl_tracking_export_from_file "$key"
  done

  # GIGL_* namespace: provider credentials plus present and future knobs
  # (timeouts, flags). Candidate enumeration is deliberately naive: the
  # tested reader above is authoritative, so a false-positive candidate
  # simply yields empty and is skipped. Comment lines cannot match (a
  # `#` cannot start an assignment) and duplicates collapse (last
  # assignment wins inside the reader, not here).
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    gigl_tracking_export_from_file "$candidate"
  done <<EOF
$(grep -o -E '^[[:space:]]*(export[[:space:]]+)?GIGL_[A-Za-z0-9_]*' "$shared_env" 2>/dev/null | grep -o -E 'GIGL_[A-Za-z0-9_]*' | sort -u || true)
EOF

  export BACI_WORKER_ENV=/dev/null
}
