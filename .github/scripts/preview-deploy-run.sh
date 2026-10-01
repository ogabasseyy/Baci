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
# Exit: 0 with a captured URL (clean success or hang-after-ready).
# Otherwise the CLI status, 124/137 on timeout without a URL, or 1 when a
# clean run prints no parseable URL.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <deploy-command...>" >&2
  exit 64
fi
: "${PREVIEW_REF:?PREVIEW_REF must be set to the target ref}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

# CLI 57 prints READY then hangs on some CI deploys (production wraps
# attempts the same way in deploy-with-retry.sh): cap below the step
# timeout and accept a captured URL on timeout. Merge stderr into the
# log: the labeled Preview line is diagnostic.
set +e
timeout -s TERM -k 2m 50m "$@" 2>&1 | tee preview-deploy.log
deploy_status=${PIPESTATUS[0]}
set -e
# Last match wins: Vercel prints the deployment assignment at the end of
# its output, after any file-upload echoes, so tail takes the real URL.
# Same convention as extract_deployment_target in deploy-with-retry.sh.
# Residual risk (attacker string echoed after the assignment) is
# accepted: nothing downstream consumes this URL except the advisory
# summary link.
# `|| true`: under pipefail a no-match grep would exit the step here,
# skipping the status-aware handling below.
preview_url="$(grep -oiE 'preview:[[:space:]]*https://[^ )]+' preview-deploy.log | grep -oE 'https://[^ ]+\.vercel\.app' | tail -n 1 || true)"
# Only clean exits and timeout kills may carry a usable URL: a nonzero
# CLI exit means finalization failed even if a Preview line was printed
# (same ordering as deploy-with-retry.sh).
if [ "$deploy_status" -ne 0 ] && [ "$deploy_status" -ne 124 ] && [ "$deploy_status" -ne 137 ]; then
  echo "Deploy failed with status $deploy_status; inspect preview-deploy.log." >&2
  exit "$deploy_status"
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
