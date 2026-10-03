#!/usr/bin/env bash

set -euo pipefail

# --skip-live-smoke keeps this verifier to install state (files, SHA, checkout,
# crontab, preflight) for pre-migration readiness. The live wrapper smoke runs
# after db-migrations instead: on a first deploy the gigl_worker_* RPCs do not
# exist until the pending migrations apply.
# --cutover-marker reduces further to install presence (files, well-formed
# SHA, canonical crontab) with no SHA-equality, checkout, preflight, or live
# checks. The deploy workflow runs it on EVERY main push: until deploy.sh has
# installed the worker and its schedule, no production deploy may land —
# diff-scoped gates alone would let an unrelated web push deploy the current
# tree (which removes the Vercel tracking cron) with no worker live.
skip_live_smoke=0
cutover_marker=0
# The $# guard keeps zero-arg runs working on bash 3.2 (macOS), where an
# unguarded "$@" under `set -u` fails with an unbound-variable error.
if [ "$#" -gt 0 ]; then
  for arg in "$@"; do
    case "$arg" in
      --skip-live-smoke) skip_live_smoke=1 ;;
      --cutover-marker)
        cutover_marker=1
        skip_live_smoke=1
        ;;
      *)
        echo "Unknown argument: $arg (expected --skip-live-smoke or --cutover-marker)" >&2
        exit 2
        ;;
    esac
  done
fi

remote_dir="${VPS_WORKER_REMOTE_DIR:-/home/bassey/baci-workers}"

echo "==> Verifying production GIGL direct workers on the deploy runner"

wrapper="$remote_dir/bin/process-gigl-tracking.sh"
if [ ! -x "$wrapper" ]; then
  echo "Missing or non-executable GIGL direct-worker wrapper: $wrapper" >&2
  exit 1
fi

capability_wrapper="$remote_dir/bin/verify-gigl-tracking-worker-capability.sh"
if [ ! -x "$capability_wrapper" ]; then
  echo "Missing or non-executable GIGL capability verifier: $capability_wrapper" >&2
  exit 1
fi

preflight="$remote_dir/jobs/preflight-direct-web-workers.mjs"
if [ ! -f "$preflight" ]; then
  echo "Missing GIGL direct-worker environment preflight: $preflight" >&2
  exit 1
fi

deployed_sha_file="$remote_dir/app-checkout.sha"
if [ ! -f "$deployed_sha_file" ]; then
  echo "Missing GIGL direct-worker deployment SHA: $deployed_sha_file" >&2
  exit 1
fi
deployed_sha="$(tr -d '\r\n' < "$deployed_sha_file")"
if [[ ! "$deployed_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid GIGL direct-worker deployment SHA." >&2
  exit 1
fi

if [ "$cutover_marker" -eq 0 ]; then
  expected_workflow_sha="${BACI_EXPECTED_APP_SHA:-${GITHUB_SHA:-}}"
  if [[ ! "$expected_workflow_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Missing or invalid expected workflow SHA." >&2
    exit 1
  fi
  if [ "$deployed_sha" != "$expected_workflow_sha" ]; then
    echo "Deployed GIGL worker does not match the current workflow SHA." >&2
    exit 1
  fi
fi

if [ "$cutover_marker" -eq 0 ]; then
  # Single dotenv reader, shared with the provisioner, the flip, and
  # the cron entrypoint: a duplicate must certify the same checkout
  # promotion flipped, in every spelling the preflight accepts.
  # Primary: the promoted copy beside this script (VPS layout);
  # fallback: the repo source, which also covers the sparse CI
  # checkout (vps-workers/bin/../../.github is present there).
  verifier_bin_dir="$(cd "$(dirname "$0")" && pwd)"
  dotenv_reader="$verifier_bin_dir/gigl-dotenv.sh"
  if [ ! -f "$dotenv_reader" ]; then
    dotenv_reader="$verifier_bin_dir/../../.github/scripts/gigl-dotenv.sh"
  fi
  if [ ! -f "$dotenv_reader" ]; then
    echo "Missing gigl-dotenv.sh beside the worker bin and the repo." >&2
    exit 1
  fi
  # shellcheck source=../../.github/scripts/gigl-dotenv.sh
  . "$dotenv_reader"
  # Last assignment wins inside the shared reader, matching dotenv,
  # the scoped-environment reader, and the flip script.
  repo_dir="$(gigl_dotenv_value "$remote_dir/.env" 'BACI_REPO_DIR')"
  case "$repo_dir" in
    /*) ;;
    *)
      echo "BACI_REPO_DIR must identify the delegated application checkout." >&2
      exit 1
      ;;
  esac

  if ! checkout_sha="$(git -C "$repo_dir" rev-parse --verify HEAD 2>/dev/null)"; then
    echo "Unable to verify the delegated application checkout." >&2
    exit 1
  fi
  if [ -n "$(git -C "$repo_dir" status --porcelain=v1 --untracked-files=all)" ]; then
    echo "Delegated application checkout is dirty." >&2
    exit 1
  fi
  if [ "$checkout_sha" != "$deployed_sha" ]; then
    echo "Delegated application checkout does not match the deployed worker SHA." >&2
    exit 1
  fi
fi

if ! installed_crontab="$(crontab -l 2>/dev/null)"; then
  echo "The VPS worker crontab is not installed." >&2
  exit 1
fi

tracking_counts="$(
  printf '%s\n' "$installed_crontab" | awk -v remote_dir="$remote_dir" '
    function command_after_schedule(line, field_index) {
      for (field_index = 0; field_index < 5; field_index += 1) {
        sub(/^[[:space:]]*[^[:space:]]+[[:space:]]+/, "", line)
      }
      return line
    }
    BEGIN {
      quote = sprintf("%c", 39)
      expected_command = "flock -n " remote_dir "/locks/gigl-tracking.lock bash -lc " quote \
        "export NODE_ENV=production && export BACI_WORKER_PROFILE=gigl-tracking && cd " remote_dir \
        " && timeout --signal=TERM --kill-after=30s 2m " remote_dir "/bin/process-gigl-tracking.sh" quote \
        " >> " remote_dir "/logs/gigl-tracking.log 2>&1"
    }
    $1 !~ /^#/ && index($0, remote_dir "/bin/process-gigl-tracking.sh") {
      total += 1
      if ($1 == "*/5" && $2 == "*" && $3 == "*" && $4 == "*" && $5 == "*" &&
          command_after_schedule($0) == expected_command) {
        canonical += 1
      }
    }
    END { print total + 0, canonical + 0 }
  '
)"
tracking_total="${tracking_counts%% *}"
tracking_canonical="${tracking_counts##* }"

if [ "$tracking_total" -ne 1 ] || [ "$tracking_canonical" -ne 1 ]; then
  echo "Expected one canonical GIGL tracking schedule; found $tracking_total total/$tracking_canonical canonical." >&2
  echo "Run bash vps-workers/deploy.sh from a clean exact-SHA checkout, then rerun production deployment." >&2
  exit 1
fi

if [ "$cutover_marker" -eq 0 ]; then
  if ! node "$preflight"; then
    echo "GIGL direct-worker environment failed its production preflight." >&2
    exit 1
  fi
fi

if [ "$skip_live_smoke" -eq 0 ]; then
  if ! NODE_ENV=production \
    BACI_WORKER_PROFILE=gigl-tracking \
    BACI_WORKER_ENV="$remote_dir/.env" \
    "$capability_wrapper"
  then
    echo "GIGL restricted database capability failed its live wrapper smoke." >&2
    exit 1
  fi
fi

echo "GIGL direct tracking worker is installed."
