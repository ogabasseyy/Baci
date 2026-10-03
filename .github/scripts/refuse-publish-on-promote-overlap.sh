#!/usr/bin/env bash
# Refuses production publish when a worker promote overlapped this run.
# Usage: refuse-publish-on-promote-overlap.sh (from the repo root, with
# GH_TOKEN set; GITHUB_RUN_ID and GITHUB_REPOSITORY come from the
# runner environment).
#
# deploy.sh records every promote in the GIGL_WORKER_PROMOTE_RECORD repo
# variable as "<sha>:<comma-separated in-flight run ids>". If this run
# id is in the record, a promote landed while this run was in flight
# and its early latch/SHA read may be stale: fail so the operator
# re-runs the workflow off fresh reads. This is the publish-side half
# of the deploy.sh mutual exclusion (the other half is the pre-promote
# refusal plus this record); it catches even runs that were invisible
# to the pre-promote query. A missing variable (nothing ever promoted)
# allows; any other read failure fails closed after retries.
set -euo pipefail

: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

overlap_err="$(mktemp 2>/dev/null)" || overlap_err=""
overlap_record=""
overlap_ok=0
overlap_attempt=0
while [ "$overlap_attempt" -lt 3 ]; do
  overlap_attempt=$((overlap_attempt + 1))
  if overlap_record="$(gh api "repos/$GITHUB_REPOSITORY/actions/variables/GIGL_WORKER_PROMOTE_RECORD" --jq '.value' 2>"${overlap_err:-/dev/null}")"; then
    overlap_ok=1
    break
  fi
  overlap_record=""
  overlap_detail=""
  if [ -n "$overlap_err" ]; then
    overlap_detail="$(cat "$overlap_err" 2>/dev/null || true)"
  fi
  case "$overlap_detail" in
    *"HTTP 404"*)
      # First rollout (or pre-record deploy.sh): nothing recorded, so
      # no promote could have overlapped this run.
      echo "No worker promote recorded yet; continuing."
      if [ -n "$overlap_err" ]; then rm -f "$overlap_err"; fi
      exit 0
      ;;
  esac
  if [ "$overlap_attempt" -lt 3 ]; then
    sleep "${OVERLAP_RETRY_DELAY_SECONDS:-10}" || true
  fi
done
if [ -n "$overlap_err" ]; then rm -f "$overlap_err"; fi
if [ "$overlap_ok" != "1" ]; then
  echo "Refusing production publish: could not read GIGL_WORKER_PROMOTE_RECORD after 3 attempts, so a mid-run worker promote cannot be ruled out. Re-run this workflow; if the read keeps failing, inspect the Actions variable and the deploy.sh promote log." >&2
  exit 1
fi
case "$overlap_record" in
  *:*)
    overlap_runs=",${overlap_record#*:},"
    ;;
  *)
    echo "Refusing production publish: GIGL_WORKER_PROMOTE_RECORD is unparseable ('$overlap_record'; want '<sha>:<run-ids>'). Re-run record_deploy_workflow_promote from the deploy checkout, then re-run this workflow." >&2
    exit 1
    ;;
esac
case "$overlap_runs" in
  *,"$GITHUB_RUN_ID",*)
    echo "Refusing production publish: a worker promote overlapped this run (record: $overlap_record), so its early latch/SHA read may be stale. Re-run this workflow off fresh reads." >&2
    exit 1
    ;;
esac
echo "No worker promote overlapped this run (record: ${overlap_record%%:*})."
