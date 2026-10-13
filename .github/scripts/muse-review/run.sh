#!/usr/bin/env bash
# Invoke the Muse agent headlessly and capture its structured review.
#
# This step's environment carries NO GitHub token (the guard step owns the
# head check): the agent authenticates only via META_API_KEY, and both token
# vars are scrubbed from its environment as defense in depth.
#
# Env in: META_API_KEY, PROMPT_FILE, MUSE_MODEL, MUSE_EFFORT, RUNNER_TEMP,
#   GITHUB_WORKSPACE, GITHUB_OUTPUT, SCRIPT_DIR.
# Output: review_file plus a model-ID notice from usage events. Exits nonzero
# when the agent or structured-output capture fails so the step outcome stays
# truthful (the step uses continue-on-error; Post renders a fallback).
set -euo pipefail

# shellcheck disable=SC1091  # SCRIPT_DIR is set by the workflow step
. "${SCRIPT_DIR}/lib.sh"

review_file="${RUNNER_TEMP}/muse-review-body.md"
model_file="${RUNNER_TEMP}/muse-model-ids.txt"
capture_file="${RUNNER_TEMP}/muse-jsonl-summary.json"
: > "${review_file}"
: > "${model_file}"

# Materialize a symlink-free workspace BEFORE the key is exposed: the agent
# inherits META_API_KEY and reads changed files, so any PR-added symlink
# (e.g. to /proc/self/environ) must already be gone. Count is logged; the
# agent simply finds those paths missing.
swept="$(sweep_workspace_symlinks "${GITHUB_WORKSPACE}")"
if (( swept > 0 )); then
  echo "::notice::Removed ${swept} workspace symlink(s) before the agent run."
fi

model_args=()
if [[ -n "${MUSE_MODEL}" ]]; then
  model_args+=(--model "${MUSE_MODEL}")
fi

# Residual risk (accepted, documented): the agent holds META_API_KEY with
# web tools ON and this runner has no egress firewall, so a prompt-injected
# model could exfiltrate the key over the network despite --disable-shell /
# --disable-write (those stop local writes, and the symlink sweep above
# stops filesystem-read exfil, but neither constrains fetch). Mitigations in
# place: the prompt forbids transmitting secrets, output is redacted before
# posting, and the key should be minimally scoped and rotated on any
# suspicious review output. Full containment would need runner-level egress
# filtering, which stock GitHub-hosted runners do not offer.
set +e
env -u GITHUB_TOKEN -u GH_TOKEN "${HOME}/.local/bin/muse" exec --json \
  --prompt-file "${PROMPT_FILE}" \
  --workspace "${GITHUB_WORKSPACE}" \
  --reasoning-effort "${MUSE_EFFORT}" \
  --max-model-steps 35 \
  --disable-approval \
  --disable-write \
  --disable-shell \
  --no-session-log \
  --output-schema "${SCRIPT_DIR}/schema.json" \
  "${model_args[@]}" </dev/null 2>"${RUNNER_TEMP}/muse-stderr.log" \
  | jq -n -f "${SCRIPT_DIR}/capture-jsonl.jq" > "${capture_file}"
run_rc=$?
set -e

echo "review_file=${review_file}" >> "${GITHUB_OUTPUT}"

capture_rc=0
if (( run_rc == 0 )); then
  if ! jq -e '.text | type == "string"' "${capture_file}" >/dev/null; then
    echo "::warning::Muse JSONL capture did not contain a completed answer."
    capture_rc=1
  else
    jq -r '.text' "${capture_file}" > "${review_file}"
    jq -r '.model_ids[]?' "${capture_file}" > "${model_file}"
  fi
fi

if (( capture_rc == 0 )); then
  if [[ -s "${model_file}" ]]; then
    model_ids="$(awk 'NF { printf "%s%s", sep, $0; sep=", " } END { print "" }' "${model_file}")"
    echo "::notice::Muse model(s) used: ${model_ids}"
  else
    echo "::notice::Muse completed without a model-usage event; exact model ID is unavailable."
  fi
else
  echo "::warning::Could not extract Muse's structured output or model ID."
fi

if (( run_rc != 0 || capture_rc != 0 )); then
  echo "::warning::Muse exec or JSONL capture failed (pipeline=${run_rc}, capture=${capture_rc}); stderr tail follows"
  # Redact-then-truncate like review bodies: the raw tail could carry
  # secrets a misbehaving model echoed to stderr.
  redact "$(cat "${RUNNER_TEMP}/muse-stderr.log" 2>/dev/null || true)" | tail -c 4000
  exit 1
fi
