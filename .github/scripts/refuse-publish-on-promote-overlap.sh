#!/usr/bin/env bash
# Refuses production publish when a worker promote overlapped this run.
# Usage: refuse-publish-on-promote-overlap.sh (from the repo root, with
# GH_TOKEN set; GITHUB_RUN_ID and GITHUB_REPOSITORY come from the
# runner environment).
#
# deploy.sh records every promote in the ops/gigl-promote-record branch
# (file .gigl-promote-record: "<sha>:<comma-separated in-flight run
# ids>", plus one barriers/<sha>-<host>-<pid> file per in-flight
# deploy, raised pre-flip and cleared post-flip/restore). Refuse when
# this run id is recorded (a promote landed mid-run, so its early
# latch/SHA read may be stale) OR when any barrier file exists (a
# promote is mid-flight right now — the ID list alone cannot see runs
# that start during a stalled refresh, so presence, not a generation
# scalar, is the durable half). This is the publish-side half of the
# deploy.sh mutual exclusion; it catches even runs that were invisible
# to the pre-promote query. A missing record fails closed: no genuine
# first rollout can reach this script, because deploy-production needs
# the cutover marker, and deploy.sh writes the pre-promote record
# before installing that marker. A 404 here therefore means the safety
# store is unavailable (deleted branch/file, or an authorization
# failure masked as 404), not that no promotion occurred. Any other
# read failure likewise fails closed after retries.
# The store is a branch (readable under the job's contents:read)
# because GITHUB_TOKEN cannot be granted the Variables permission an
# Actions-variable record would need.
set -euo pipefail

: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

overlap_err="$(mktemp 2>/dev/null)" || overlap_err=""
overlap_barrier=""
overlap_barrier_ok=0
overlap_attempt=0
while [ "$overlap_attempt" -lt 3 ]; do
  overlap_attempt=$((overlap_attempt + 1))
  # No raw accept header: directories always answer JSON. A barrier
  # entry looks like {"name":"...","path":"barriers/...",...}.
  if overlap_barrier="$(gh api "repos/$GITHUB_REPOSITORY/contents/barriers?ref=ops/gigl-promote-record" 2>"${overlap_err:-/dev/null}")"; then
    overlap_barrier_ok=1
    break
  fi
  overlap_barrier=""
  overlap_detail=""
  if [ -n "$overlap_err" ]; then
    overlap_detail="$(cat "$overlap_err" 2>/dev/null || true)"
  fi
  case "$overlap_detail" in
    *"HTTP 404"*)
      # No barriers directory: no promote is mid-flight. (An empty
      # dir cannot exist in git, so 404 is the only clear state.)
      overlap_barrier_ok=1
      overlap_barrier="[]"
      break
      ;;
  esac
  if [ "$overlap_attempt" -lt 3 ]; then
    sleep "${OVERLAP_RETRY_DELAY_SECONDS:-10}" || true
  fi
done
if [ "$overlap_barrier_ok" != "1" ]; then
  echo "Refusing production publish: could not read the worker promote barriers (ops/gigl-promote-record) after 3 attempts, so a mid-run worker promote cannot be ruled out. Re-run this workflow; if the read keeps failing, inspect the ops branch and the deploy.sh promote log." >&2
  exit 1
fi
case "$overlap_barrier" in
  *'"path":"barriers/'* | *'"path":"barriers"'*)
    # The second alternative is a file where the directory belongs
    # (corrupt — our writer only ever creates the dir): block anyway.
    echo "Refusing production publish: a worker promote is in progress (in-flight barrier present), so this run's early latch/SHA read cannot be trusted. Re-run this workflow once the promote completes; if no deploy is running, a crashed deploy left a stale barrier — clear it per the cutover runbook, then re-run." >&2
    exit 1
    ;;
esac
overlap_record=""
overlap_ok=0
overlap_attempt=0
while [ "$overlap_attempt" -lt 3 ]; do
  overlap_attempt=$((overlap_attempt + 1))
  if overlap_record="$(gh api -H 'Accept: application/vnd.github.raw' "repos/$GITHUB_REPOSITORY/contents/.gigl-promote-record?ref=ops/gigl-promote-record" 2>"${overlap_err:-/dev/null}")"; then
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
      # Not a first rollout (see header): the marker gate proves a
      # promote already landed, so the record must exist. A missing
      # branch/file means the safety store is unavailable — deleted,
      # or an authorization failure masked as 404 — and an
      # overlapping worker flip could publish from stale latch/SHA
      # reads. Fail closed without retrying: a missing object is not
      # transient.
      echo "Refusing production publish: the worker promote record (ops/gigl-promote-record) is missing, so a mid-run worker promote cannot be ruled out. Re-run record_deploy_workflow_promote from the deploy checkout, then re-run this workflow; if the ops branch was deleted, restore it first, and if the token lost read access, restore that instead." >&2
      if [ -n "$overlap_err" ]; then rm -f "$overlap_err"; fi
      exit 1
      ;;
  esac
  if [ "$overlap_attempt" -lt 3 ]; then
    sleep "${OVERLAP_RETRY_DELAY_SECONDS:-10}" || true
  fi
done
if [ -n "$overlap_err" ]; then rm -f "$overlap_err"; fi
if [ "$overlap_ok" != "1" ]; then
  echo "Refusing production publish: could not read the worker promote record (ops/gigl-promote-record) after 3 attempts, so a mid-run worker promote cannot be ruled out. Re-run this workflow; if the read keeps failing, inspect the ops branch and the deploy.sh promote log." >&2
  exit 1
fi
case "$overlap_record" in
  *:*)
    overlap_runs=",${overlap_record#*:},"
    ;;
  *)
    echo "Refusing production publish: the worker promote record is unparseable ('$overlap_record'; want '<sha>:<run-ids>'). Re-run record_deploy_workflow_promote from the deploy checkout, then re-run this workflow." >&2
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
