#!/usr/bin/env bash
# Collects the pull request (metadata, changed files, diff, full contents of changed files at the
# head commit) and writes the review prompt to a FILE. Nothing from the pull request is executed.
#
# Env in: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, SCRIPT_DIR, RUNNER_TEMP, GITHUB_OUTPUT.
# Outputs: head_sha, base_ref, should_review, prompt_file, fingerprint, changed_files_file.
set -euo pipefail

pr_file="${RUNNER_TEMP}/gemini-pr.json"
gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" > "${pr_file}"

head_sha="$(jq -r '.head.sha' "${pr_file}")"
base_ref="$(jq -r '.base.ref' "${pr_file}")"
head_ref="$(jq -r '.head.ref' "${pr_file}")"
pr_state="$(jq -r '.state' "${pr_file}")"
pr_title="$(jq -r '.title' "${pr_file}")"
pr_body="$(jq -r '.body // ""' "${pr_file}")"

echo "head_sha=${head_sha}" >> "${GITHUB_OUTPUT}"
echo "base_ref=${base_ref}" >> "${GITHUB_OUTPUT}"

if [[ "${pr_state}" != "open" ]]; then
  echo "should_review=false" >> "${GITHUB_OUTPUT}"
  echo "::notice::Pull request #${PR_NUMBER} is not open; skipping Gemini review."
  exit 0
fi
echo "should_review=true" >> "${GITHUB_OUTPUT}"

# Changed-file summary (paginated; arrays are merged by --paginate).
files_file="${RUNNER_TEMP}/gemini-files.json"
gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files?per_page=100" \
  | jq -s 'add' > "${files_file}"

# File names are untrusted. One with a control character (newline, tab...) could add lines to the
# prompt or to this list, so such names are left out of the list and shown with "?" in the summary.
changed_files_file="${RUNNER_TEMP}/gemini-changed-files.txt"
jq -r '.[] | select(.filename | explode | any(. < 32 or . == 127) | not) | .filename' "${files_file}" > "${changed_files_file}"
echo "changed_files_file=${changed_files_file}" >> "${GITHUB_OUTPUT}"
# Files the model cannot be shown (control characters in the name) make a clean answer meaningless;
# the post step turns a "success" into an abstention when this is not zero.
unreviewable_files="$(jq '[.[] | select(.status != "removed") | select(.filename | explode | any(. < 32 or . == 127))] | length' "${files_file}")"
echo "unreviewable_files=${unreviewable_files}" >> "${GITHUB_OUTPUT}"

files_summary="$(
  jq -r '.[] | "- \(.filename | explode | map(if . < 32 or . == 127 then 63 else . end) | implode) [\(.status)] +\(.additions) / -\(.deletions)"' "${files_file}"
)"
if [[ -z "${files_summary}" ]]; then
  files_summary="- No file-level diff metadata was returned by the GitHub API."
fi

# Unified diff. The fingerprint is taken from the WHOLE diff, before truncation: it names what the
# pull request changes, so a push that only merges main in keeps it and skips the paid review.
diff_file="${RUNNER_TEMP}/gemini.diff"
gh pr diff "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" > "${diff_file}" || true
fingerprint="$(node "${SCRIPT_DIR}/fingerprint.mjs" < "${diff_file}")"
echo "fingerprint=${fingerprint}" >> "${GITHUB_OUTPUT}"

budget=30000
diff_len="$(wc -c < "${diff_file}")"
diff_note=""
if (( diff_len > budget )); then
  head -c "${budget}" "${diff_file}" > "${diff_file}.trunc"
  printf '\n[... diff truncated at %s bytes; review the remaining changes manually ...]\n' "${budget}" >> "${diff_file}.trunc"
  mv "${diff_file}.trunc" "${diff_file}"
  diff_note=" (truncated)"
fi
if [[ ! -s "${diff_file}" ]]; then
  printf '(No textual diff was returned by the GitHub API.)\n' > "${diff_file}"
fi

# Full current content of each changed (non-removed) file at the head SHA. Reviewing complete
# files, not just the diff, stops the model from flagging code/config it could not see as "missing".
full_files_file="${RUNNER_TEMP}/gemini-full-files.md"
: > "${full_files_file}"
files_budget=45000
per_file_budget=25000
content_file="${RUNNER_TEMP}/gemini-file-content"
checkout_root="$(pwd -P)"
while IFS= read -r -d '' path && IFS= read -r -d '' file_status; do
  if [[ "${file_status}" == "removed" ]]; then
    continue
  fi
  if [[ "${path}" == *[[:cntrl:]]* ]]; then
    printf '\n<file path="(unprintable name)">(content omitted: file name has control characters)</file>\n' >> "${full_files_file}"
    continue
  fi
  # HTML-escape the path before placing it in the <file path="..."> attribute so a crafted
  # filename (Git allows " < >) cannot break out of the tag.
  display_path="$(printf '%s' "${path}" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')"
  if (( files_budget <= 0 )); then
    printf '\n<file path="%s">(omitted: full-content budget exhausted; see diff above)</file>\n' "${display_path}" >> "${full_files_file}"
    continue
  fi
  # Read the file from the checked-out PR head, no per-file API call.
  if [[ ! -e "${path}" && ! -L "${path}" ]]; then
    printf '\n<file path="%s">(content could not be read)</file>\n' "${display_path}" >> "${full_files_file}"
    continue
  fi
  # A pull request can contain symlinks. Never follow one out of the checkout: it could point at
  # runner files (the step's own environment, for example) whose content would go to the model.
  real_path="$(realpath -- "${path}" 2>/dev/null || true)"
  if [[ -z "${real_path}" || "${real_path}" != "${checkout_root}/"* || ! -f "${real_path}" ]]; then
    printf '\n<file path="%s">(content omitted: not a regular file inside the checkout)</file>\n' "${display_path}" >> "${full_files_file}"
    continue
  fi
  if ! cp -- "${real_path}" "${content_file}" 2>/dev/null; then
    printf '\n<file path="%s">(content could not be read)</file>\n' "${display_path}" >> "${full_files_file}"
    continue
  fi
  # Check emptiness before the mime probe: `file --mime-encoding` reports 0-byte files as "binary".
  if [[ ! -s "${content_file}" ]]; then
    printf '\n<file path="%s">(empty file)</file>\n' "${display_path}" >> "${full_files_file}"
    continue
  fi
  if [[ "$(file --mime-encoding -b "${content_file}")" == "binary" ]]; then
    printf '\n<file path="%s">(binary file omitted)</file>\n' "${display_path}" >> "${full_files_file}"
    continue
  fi
  cap=${per_file_budget}
  if (( cap > files_budget )); then
    cap=${files_budget}
  fi
  file_note=""
  if (( $(wc -c < "${content_file}") > cap )); then
    head -c "${cap}" "${content_file}" > "${content_file}.trunc"
    mv "${content_file}.trunc" "${content_file}"
    file_note=" (truncated)"
  fi
  files_budget=$(( files_budget - $(wc -c < "${content_file}") ))
  # Wrap in <file> tags (not ``` fences) so file contents that contain triple backticks don't
  # close the block early.
  {
    if [[ -n "${file_note}" ]]; then
      printf '\n<file path="%s" truncated="true">\n' "${display_path}"
    else
      printf '\n<file path="%s">\n' "${display_path}"
    fi
    # Drop invalid/partial UTF-8 (byte truncation) so the prompt stays valid UTF-8, and
    # neutralize any literal </file> or </diff> so attacker-controlled file content cannot close
    # this wrapper or inject prompt structure.
    iconv -c -f UTF-8 -t UTF-8 "${content_file}" 2>/dev/null \
      | perl -pe 's{<\s*/\s*(file|diff)}{<\\/$1}gi' || true
    printf '\n</file>\n'
  } >> "${full_files_file}"
done < <(jq -j '.[] | .filename, "\u0000", .status, "\u0000"' "${files_file}")
if [[ ! -s "${full_files_file}" ]]; then
  printf '(No changed-file contents were available.)\n' > "${full_files_file}"
fi

prompt_file="${RUNNER_TEMP}/gemini-prompt.md"
{
  printf 'Review GitHub pull request #%s for repository %s.\n' "${PR_NUMBER}" "${GITHUB_REPOSITORY}"
  printf 'Base branch: %s\nHead branch: %s\nHead SHA: %s\n\n' \
    "${base_ref}" "${head_ref}" "${head_sha}"
  # PR title/description are attacker-controlled; wrap in tags and neutralize closing delimiters
  # so they cannot break structure or inject instructions (the contract marks these tags untrusted).
  printf '<pr_title>\n%s\n</pr_title>\n\n' \
    "$(printf '%s' "${pr_title}" | perl -pe 's{<\s*/\s*(file|diff|pr_title|pr_description)}{<\\/$1}gi')"
  printf '<pr_description>\n%s\n</pr_description>\n\n' \
    "$(if [[ -n "${pr_body}" ]]; then printf '%s' "${pr_body}" | perl -pe 's{<\s*/\s*(file|diff|pr_title|pr_description)}{<\\/$1}gi'; else printf '(empty)'; fi)"

  cat "${SCRIPT_DIR}/contract.md"

  printf '\n## Changed files\n%s\n' "${files_summary}"
  printf '\n## Unified diff%s\n\n<diff>\n' "${diff_note}"
  iconv -c -f UTF-8 -t UTF-8 "${diff_file}" 2>/dev/null \
    | perl -pe 's{<\s*/\s*(file|diff)}{<\\/$1}gi' || true
  printf '\n</diff>\n'
  printf '\n## Full content of changed files\n'
  cat "${full_files_file}"
} > "${prompt_file}"

# Hard-cap the assembled prompt (the changed-files summary is not otherwise size-bounded on very
# large PRs): it bounds the tokens, and so the price, of one review. Sanitized to valid UTF-8.
max_prompt_bytes=90000
if (( $(wc -c < "${prompt_file}") > max_prompt_bytes )); then
  head -c "${max_prompt_bytes}" "${prompt_file}" | iconv -c -f UTF-8 -t UTF-8 > "${prompt_file}.cap" 2>/dev/null || true
  printf '\n\n[Prompt truncated to bound the cost of one review; review the remaining diff/files directly.]\n' >> "${prompt_file}.cap"
  mv "${prompt_file}.cap" "${prompt_file}"
fi

echo "prompt_file=${prompt_file}" >> "${GITHUB_OUTPUT}"
echo "::notice::Prompt for #${PR_NUMBER}: $(wc -c < "${prompt_file}") bytes, fingerprint ${fingerprint:-none}"
