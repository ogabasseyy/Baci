#!/usr/bin/env bash
# Invoke the Muse agent headlessly and capture its structured review.
#
# This step's environment carries NO GitHub token (the guard step owns the
# head check): the agent authenticates only via META_API_KEY, and both token
# vars are scrubbed from its environment as defense in depth.
#
# Env in: META_API_KEY, PROMPT_FILE, MUSE_MODEL, MUSE_EFFORT, RUNNER_TEMP,
#   GITHUB_WORKSPACE, GITHUB_OUTPUT, SCRIPT_DIR.
# Output: review_file. Exits nonzero when the agent fails so the step outcome
# stays truthful (the step uses continue-on-error; Post renders a fallback).
set -euo pipefail

review_file="${RUNNER_TEMP}/muse-review-body.md"
: > "${review_file}"

model_args=()
if [[ -n "${MUSE_MODEL}" ]]; then
  model_args+=(--model "${MUSE_MODEL}")
fi

set +e
env -u GITHUB_TOKEN -u GH_TOKEN "${HOME}/.local/bin/muse" exec \
  --prompt-file "${PROMPT_FILE}" \
  --workspace "${GITHUB_WORKSPACE}" \
  --reasoning-effort "${MUSE_EFFORT}" \
  --max-model-steps 35 \
  --disable-approval \
  --disable-write \
  --disable-shell \
  --no-session-log \
  --output-schema "${SCRIPT_DIR}/schema.json" \
  ${model_args[@]+"${model_args[@]}"} </dev/null > "${review_file}" 2>"${RUNNER_TEMP}/muse-stderr.log"
muse_rc=$?
set -e

echo "review_file=${review_file}" >> "${GITHUB_OUTPUT}"

if (( muse_rc != 0 )); then
  echo "::warning::muse exec exited ${muse_rc}; stderr tail follows"
  tail -c 4000 "${RUNNER_TEMP}/muse-stderr.log" || true
  exit "${muse_rc}"
fi
