#!/usr/bin/env bash
# Invoke the Muse agent headlessly and capture its structured review.
#
# This step's environment carries NO GitHub token (the guard step owns the
# head check): the agent authenticates only via META_API_KEY, and both token
# vars are scrubbed from its environment as defense in depth.
#
# Env in: META_API_KEY, PROMPT_FILE, MUSE_MODEL, MUSE_EFFORT, RUNNER_TEMP,
#   GITHUB_WORKSPACE, GITHUB_OUTPUT, SCRIPT_DIR.
# Output: review_file plus a model-ID notice from the retained Muse session.
# Exits nonzero
# when the agent or structured-output capture fails so the step outcome stays
# truthful (the step uses continue-on-error; Post renders a fallback).
set -euo pipefail

# shellcheck disable=SC1091  # SCRIPT_DIR is set by the workflow step
. "${SCRIPT_DIR}/lib.sh"

review_file="${RUNNER_TEMP}/muse-review-body.md"
model_file="${RUNNER_TEMP}/muse-model-ids.txt"
capture_file="${RUNNER_TEMP}/muse-jsonl-summary.json"
jsonl_file="${RUNNER_TEMP}/muse-stream.jsonl"
session_export="${RUNNER_TEMP}/muse-session-export.json"
stderr_file="${RUNNER_TEMP}/muse-stderr.log"
export XDG_DATA_HOME="${RUNNER_TEMP}/muse-data"
mkdir -p -m 700 "${XDG_DATA_HOME}"
: > "${review_file}"
: > "${model_file}"

cleanup() {
  rm -rf "${XDG_DATA_HOME}"
  rm -f "${session_export}" "${stderr_file}" "${jsonl_file}"
}
trap cleanup EXIT

# Optional explicit model selection (repo MUSE_MODEL variable). When empty,
# the CLI default applies; either way the model IDs actually used are
# recorded from the run's token-usage events below.
model_args=()
if [[ -n "${MUSE_MODEL:-}" ]]; then
  model_args+=(--model "${MUSE_MODEL}")
fi

# Materialize a symlink-free workspace BEFORE the key is exposed: the agent
# inherits META_API_KEY and reads changed files, so any PR-added symlink
# (e.g. to /proc/self/environ) must already be gone. Count is logged; the
# agent simply finds those paths missing.
swept="$(sweep_workspace_symlinks "${GITHUB_WORKSPACE}")"
if (( swept > 0 )); then
  echo "::notice::Removed ${swept} workspace symlink(s) before the agent run."
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
  --output-schema "${SCRIPT_DIR}/schema.json" \
  "${model_args[@]}" \
  </dev/null >"${jsonl_file}" 2>"${stderr_file}"
muse_rc=$?
# The capture runs as a separate command (not a pipeline) so a
# malformed JSONL stream fails loudly instead of leaving a partial
# capture_file that later validation might misread.
if (( muse_rc == 0 )); then
  if jq -n -f "${SCRIPT_DIR}/capture-jsonl.jq" <"${jsonl_file}" >"${capture_file}" 2>/dev/null; then
    :
  else
    echo "::warning::Muse JSONL capture failed; stderr tail follows"
    redact "$(cat "${stderr_file}" 2>/dev/null || true)" | tail -c 4000
    exit 5
  fi
else
  echo "::warning::Muse exec failed; stderr tail follows"
  redact "$(cat "${stderr_file}" 2>/dev/null || true)" | tail -c 4000
  exit "$muse_rc"
fi
set -e

echo "review_file=${review_file}" >> "${GITHUB_OUTPUT}"

capture_rc=0
if ! jq -e '.text | type == "string"' "${capture_file}" >/dev/null; then
  echo "::warning::Muse JSONL capture did not contain a completed answer."
  capture_rc=1
else
  jq -r '.text' "${capture_file}" > "${review_file}"
  set +e
  env -u GITHUB_TOKEN -u GH_TOKEN "${HOME}/.local/bin/muse" export --last --out "${session_export}" --redacted >/dev/null 2>"${stderr_file}"
  export_rc=$?
  set -e
  if (( export_rc == 0 )); then
    if ! jq -r -f "${SCRIPT_DIR}/capture-model-ids.jq" "${session_export}" > "${model_file}"; then
      : > "${model_file}"
      echo "::notice::Muse session export could not be parsed; exact model ID is unavailable."
    fi
  else
    echo "::notice::Muse completed, but its temporary session export was unavailable; exact model ID is unavailable."
  fi
  # Remove the raw session store immediately: a hard kill of this step
  # would otherwise bypass the EXIT trap and leave the unredacted
  # session (prompt, diff, tool traces) on the runner for later steps.
  rm -rf "${XDG_DATA_HOME}"
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

if (( capture_rc != 0 )); then
  echo "::warning::Muse structured-output capture failed (capture=${capture_rc}); stderr tail follows"
  # Redact-then-truncate like review bodies: the raw tail could carry
  # secrets a misbehaving model echoed to stderr.
  redact "$(cat "${stderr_file}" 2>/dev/null || true)" | tail -c 4000
  exit 1
fi
