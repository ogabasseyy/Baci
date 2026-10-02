# shellcheck shell=bash
# Scopes the GIGL tracking/smoke process environment to an allowlist.
# Source it from the GIGL cron entries BEFORE delegating to
# run-web-script.sh; do not execute. Usage:
#   . "$SCRIPT_DIR/gigl-tracking-scoped-env.sh"
#   gigl_tracking_scope_env
#   gigl_tracking_exec_scoped "$SCRIPT_DIR/run-web-script.sh" <label> <script>
#
# The shared worker .env holds every worker's secrets (SUPABASE_SERVICE_ROLE_KEY,
# petrock/jumia/quiz credentials, encryption keys...). The provider-facing GIGL
# poller must never see them: code execution in that process would bypass all
# five wrapper restrictions. This filter exports ONLY the GIGL allowlist below,
# records its names, then the exec helper below replaces the process image
# under a constructed environment (env -i): allowlisted names plus the
# non-secret infrastructure (NODE_ENV, BACI_WORKER_PROFILE, PATH, HOME),
# nothing else. A caller-set allowlisted value wins over the file (exact
# dotenv precedence); every other caller-exported variable -- a service key
# lingering in a cron/SSH/runner environment, GITHUB_TOKEN in CI -- is
# dropped at that boundary even though BACI_WORKER_ENV=/dev/null only stops
# further FILE loads. GIGL_ENV_FILE_AUTHORITATIVE=1 inverts the precedence
# for allowlisted names (the file always wins; file-absent caller values
# are dropped): the smoke entry sets it because a smoke certifies the
# installed dotenv, while the poller keeps caller-wins for manual runs
# (cron's minimal env makes it a no-op there).
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

  # Allowlisted names for gigl_tracking_exec_scoped, space-separated.
  # Append-only inside gigl_tracking_export_from_file; never exported, so
  # the bookkeeping itself cannot leak into the child. The three fixed
  # names below and the GIGL_* enumeration cannot overlap each other or
  # the exec helper's infrastructure list (NODE_ENV, BACI_WORKER_PROFILE,
  # PATH, HOME), so no name can appear twice.
  GIGL_SCOPED_ENV_NAMES=""

  gigl_tracking_export_from_file() {
    local export_key="$1" export_value
    GIGL_SCOPED_ENV_NAMES="${GIGL_SCOPED_ENV_NAMES:+$GIGL_SCOPED_ENV_NAMES }$export_key"
    # A set process variable wins even when empty (exact dotenv
    # precedence); printenv exits 0 for set-but-empty on coreutils/BSD.
    # File-authoritative mode (GIGL_ENV_FILE_AUTHORITATIVE=1, set by the
    # smoke entry) skips this: the smoke certifies the INSTALLED dotenv,
    # so a runner export must never override the file value being proven.
    if [ "${GIGL_ENV_FILE_AUTHORITATIVE:-}" != "1" ] && printenv "$export_key" >/dev/null 2>&1; then
      return 0
    fi
    export_value="$(gigl_dotenv_value "$shared_env" "$export_key")"
    if [ -n "$export_value" ]; then
      export "$export_key=$export_value"
    else
      # File-authoritative with a file-absent key: drop any caller value
      # so the exec boundary cannot pass an uncertified override. (In
      # default mode this only fires when the caller never set the key,
      # so the unset is a no-op there.)
      unset "$export_key"
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

# Replace the process image with the child (run-web-script.sh) under a
# constructed environment instead of the inherited one. Must run after
# gigl_tracking_scope_env in the same shell. Unset names are skipped, so
# file-missing keys simply stay absent; set-but-empty values pass through
# (printenv exits 0 for those). Never returns on success.
gigl_tracking_exec_scoped() {
  : "${GIGL_SCOPED_ENV_NAMES:?gigl_tracking_scope_env must run before gigl_tracking_exec_scoped}"
  local exec_args=() exec_name exec_value
  # Word splitting is intentional: the names list is space-separated.
  # shellcheck disable=SC2086
  for exec_name in $GIGL_SCOPED_ENV_NAMES NODE_ENV BACI_WORKER_PROFILE PATH HOME; do
    if printenv "$exec_name" >/dev/null 2>&1; then
      exec_value="$(printenv "$exec_name")"
      exec_args+=("$exec_name=$exec_value")
    fi
  done
  exec_args+=("BACI_WORKER_ENV=/dev/null")
  exec env -i "${exec_args[@]}" "$@"
}
