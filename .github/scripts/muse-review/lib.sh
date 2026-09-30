# Shared pure helpers for the Muse review workflow.
# shellcheck shell=bash
#
# Sourced (never executed) by collect.sh, diff.sh, guidance.sh, prompt.sh,
# post.sh, and test.sh. Portable to bash 3.2 (macOS) and bash 5 (runner):
# no associative arrays, no mapfile, no namerefs.
#
# Every function here is pure (stdin/stdout/args only, no network, no repo
# state) so test.sh can exercise each one deterministically.

# Escape block-closing tags (</diff>, </file>, ...) so submitter-controlled
# text cannot break out of its prompt block. Single unified tag list for all
# blocks — neutralizing more is strictly safer than less.
neutralize_tags() {
  perl -pe 's{<\s*/\s*(file|diff|pr_title|pr_description|changed_files|removed_lines|head_ref|base_ref|untrusted_guidance)}{<\\/$1}gi'
}

# In-place byte cap for a file. Only replaces the original when truncation
# succeeds, so a failed head/iconv can never clobber evidence with a
# partial file. Prints nothing; returns nonzero when the file is unreadable.
cap_file() {
  local _file="$1" _cap="$2" _tmp
  [[ -r "${_file}" ]] || return 1
  if (( $(wc -c < "${_file}") > _cap )); then
    _tmp="${_file}.trunc.$$"
    if head -c "${_cap}" "${_file}" | iconv -c -f UTF-8 -t UTF-8 > "${_tmp}" 2>/dev/null; then
      mv "${_tmp}" "${_file}"
    else
      rm -f "${_tmp}"
      return 1
    fi
  fi
}

# Byte-bounded UTF-8-safe truncation of a string, with an explicit marker.
# head reads a temp FILE (never a live pipe) so no writer can SIGPIPE;
# iconv -c drops a split trailing multibyte char. Bash ${var:0:N} is
# char-based and would overshoot byte budgets on non-ASCII text.
bound_untrusted() {
  local _in="$1" _cap="$2" _tmp
  if (( $(printf '%s' "${_in}" | wc -c) > _cap )); then
    _tmp="$(mktemp)"
    printf '%s' "${_in}" > "${_tmp}"
    printf '%s\n[... truncated at %s bytes ...]' \
      "$(head -c "${_cap}" "${_tmp}" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null || true)" "${_cap}"
    rm -f "${_tmp}"
  else
    printf '%s' "${_in}"
  fi
}

# Byte-bounded UTF-8-safe truncation of stdin (no marker). Same temp-file
# discipline as bound_untrusted.
trunc_bytes() {
  local bytes="$1" tmp
  tmp="$(mktemp)"
  cat > "${tmp}"
  head -c "${bytes}" "${tmp}" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null || true
  rm -f "${tmp}"
}

# Scrub secret patterns from review text before it is posted publicly.
# Private keys redact as full header-to-footer blocks; provider prefixes,
# JWTs, and key-assignment pairs (api_key="...", token: ...) redact by
# value. Always redact BEFORE truncating: cutting first could remove a PEM
# footer and defeat the full-block match.
redact() {
  printf '%s' "$1" | perl -0777 -pe 's/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----/[REDACTED-PRIVATE-KEY]/gs; s/\b(sk-|rk-|ghp_|gho_|github_pat_|xox[bap]-|AKIA)[A-Za-z0-9_\-]+/[REDACTED]/g; s/eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+/[REDACTED-JWT]/g; s/((?:api[_-]?key|secret|token|password)\s*[:=]\s*["'"'"']?)[A-Za-z0-9_\-.\/+]{12,}/${1}[REDACTED]/gi'
}

# Guidance trust: a PR base branch is contributor-controlled unless it is the
# repo default branch, so only default-branch base content earns "trusted"
# status; stacked-PR and custom bases stay isolated as UNTRUSTED. Prints
# true/false. Fails closed on unknown default branch.
trust_base() {
  local _base_ref="$1" _default="$2" _available="$3"
  if [[ "${_available}" == "true" && -n "${_default}" && "${_base_ref}" == "${_default}" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

# Candidate identity without newline mangling. Newline-delimited seen-files
# break when a directory contains a newline (one candidate becomes several
# apparent lines and can suppress a real later candidate), so identity lives
# in an indexed array compared exactly — no serialization, no assoc arrays
# (bash 3.2 compatible). Callers iterate MUSE_CANDIDATES in order.
MUSE_SEEN=()
MUSE_CANDIDATES=()
seen_reset() {
  MUSE_SEEN=()
  MUSE_CANDIDATES=()
}
seen_add() {
  local _candidate="$1" _known
  for _known in ${MUSE_SEEN[@]+"${MUSE_SEEN[@]}"}; do
    if [[ "${_known}" == "${_candidate}" ]]; then return 0; fi
  done
  MUSE_SEEN+=("${_candidate}")
  MUSE_CANDIDATES+=("${_candidate}")
}
