#!/usr/bin/env bash
# Run a Vercel prebuilt preview deploy with hang recovery and URL capture.
#
# Usage: preview-deploy-run.sh <deploy-command...>
# The deploy command arrives as argv so tests can substitute a stub; in the
# workflow it is always the trusted pinned-CLI runner with prebuilt flags
# (pinned exactly by the contract suite).
#
# Env in: PREVIEW_REF (free-form target ref, sanitized for the summary only),
#   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY (runner-provided).
# Writes preview-deploy.log in the working directory; publishes the
# preview_url step output and the advisory summary link.
#
# Exit: 0 with a captured URL (clean success, or a hang whose URL
# inspects as a live deployment). Otherwise the CLI status, 124/137 on
# timeout without a URL (or with an unverified one), or 1 when a clean
# run prints no parseable URL.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <deploy-command...>" >&2
  exit 64
fi
# First argv word is the CLI runner (pinned-CLI script in the workflow,
# stub in tests); reused for the timeout-path readiness check below.
vercel_runner="$1"
: "${PREVIEW_REF:?PREVIEW_REF must be set to the target ref}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

# The CLI prints READY then hangs on some CI deploys (production wraps
# attempts the same way in deploy-with-retry.sh): cap the deploy at 45m
# (47m worst case with the KILL grace) so the 5m readiness inspect and
# job setup still fit the 60m deploy-job budget with margin. Merge
# stderr into the log: the labeled Preview line is diagnostic.
set +e
timeout -s TERM -k 2m 45m "$@" 2>&1 | tee preview-deploy.log
deploy_status=${PIPESTATUS[0]}
set -e
# Last match wins: Vercel prints the deployment assignment at the end of
# its output, after any file-upload echoes, so tail takes the real URL.
# Same convention as extract_deployment_target in deploy-with-retry.sh.
# The host is pinned to this project's deployment namespace (verified:
# 10/10 recent deployments, Preview included, match
# baci-<id>-basseys-projects-d7395611.vercel.app; branch-derived hosts
# keep the same project/team affixes). Off-project lookalikes cannot
# match, so a planted URL cannot point the advisory link at live
# attacker-controlled content; residual is a dead same-namespace link.
# If Vercel ever changes the form, capture fails closed (exit 1).
# Rotation: take the new suffix from `vercel ls`, update this pattern
# plus the contract assertion and the deploy-run fixture/tests.
# `|| true`: under pipefail a no-match grep would exit the step here,
# skipping the status-aware handling below.
preview_url="$(grep -oiE 'preview:[[:space:]]*https://[^ )]+' preview-deploy.log | grep -oE 'https://baci-[A-Za-z0-9-]*-basseys-projects-d7395611\.vercel\.app' | tail -n 1 || true)"
# Only clean exits and timeout kills may carry a usable URL: a nonzero
# CLI exit means finalization failed even if a Preview line was printed
# (same ordering as deploy-with-retry.sh).
if [ "$deploy_status" -ne 0 ] && [ "$deploy_status" -ne 124 ] && [ "$deploy_status" -ne 137 ]; then
  echo "Deploy failed with status $deploy_status; inspect preview-deploy.log." >&2
  exit "$deploy_status"
fi
# A timeout kill cannot distinguish 'hung after READY' from 'killed
# mid-finalization after an early Preview line' (production answers the
# same question by promoting; previews verify with a bounded read-only
# inspect). Bare inspect proves existence only, so wait for completion
# (self-bounding --timeout; verified: exit 0 on Ready, 1 on Error) and
# require readyState READY from the machine-readable JSON too, so
# neither exit-semantics nor display-wording drift can sell a failed
# deployment as success. Either failure keeps the timeout status: loud
# and retryable, never a false 'Preview ready'.
if [ "$deploy_status" -eq 124 ] || [ "$deploy_status" -eq 137 ]; then
  if [ -n "$preview_url" ]; then
    inspect_output="$("$vercel_runner" inspect --wait --timeout 5m --format json "$preview_url" 2>/dev/null)" || inspect_failed=1
    if [ "${inspect_failed:-0}" -ne 0 ] || ! printf '%s' "$inspect_output" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{process.exit(JSON.parse(s).readyState==='READY'?0:1)}catch(e){process.exit(1)}})"; then
      echo "Deploy timed out and $preview_url did not verify as a Ready deployment; check the Vercel dashboard for an orphaned deployment before retrying." >&2
      exit "$deploy_status"
    fi
  fi
fi
if [ -z "$preview_url" ]; then
  if [ "$deploy_status" -eq 124 ] || [ "$deploy_status" -eq 137 ]; then
    echo 'Deploy timed out without printing a Preview URL; check the Vercel dashboard for an orphaned deployment before retrying.' >&2
    exit "$deploy_status"
  else
    echo 'Could not find the Preview URL in the deploy log; inspect preview-deploy.log.' >&2
    exit 1
  fi
fi
echo "preview_url=$preview_url" >> "$GITHUB_OUTPUT"
# Dispatch inputs are free-form: strip newlines and carriage returns as
# well as backticks, then render inside a code span, so the summary
# heading stays one line and cannot be reshaped.
safe_ref="$(printf '%s' "$PREVIEW_REF" | tr -d '\n\r`')"
echo "## Preview ready for \`$safe_ref\`: $preview_url" >> "$GITHUB_STEP_SUMMARY"
