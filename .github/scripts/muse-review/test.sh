#!/usr/bin/env bash
# Regression tests for the Muse review workflow's pure helpers.
#
# Runs with bash 3.2+ (macOS) and bash 5 (CI): no associative arrays, no
# mapfile. No network, no repo state, deterministic. Fixtures use obviously
# fake credentials only. Exit nonzero on any failure.
#
# Usage: bash test.sh   (from this directory; SCRIPT_DIR defaults accordingly)
set -uo pipefail

SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

pass=0
fail=0
fail_names=""
assert_eq() {
  local _name="$1" _want="$2" _got="$3"
  if [[ "${_want}" == "${_got}" ]]; then
    pass=$(( pass + 1 ))
  else
    fail=$(( fail + 1 ))
    fail_names="${fail_names} ${_name}"
    printf 'FAIL %s\n  want: %s\n  got:  %s\n' "${_name}" "${_want}" "${_got}"
  fi
}

# --- neutralize_tags ---
got="$(printf '%s' 'ok </diff> and </FILE > done' | neutralize_tags)"
assert_eq "neutralize-escapes" 'ok <\/diff> and <\/FILE > done' "${got}"
got="$(printf '%s' 'plain <diff> text' | neutralize_tags)"
assert_eq "neutralize-keeps-open" 'plain <diff> text' "${got}"

# --- bound_untrusted ---
big="$(python3 -c "print('x'*5000)")"
got="$(bound_untrusted "${big}" 2000)"
assert_eq "bound-ascii-bytes" "2034" "$(printf '%s' "${got}" | wc -c | tr -d ' ')"
case "${got}" in *"[... truncated at 2000 bytes ...]"*) got_marker="yes";; *) got_marker="no";; esac
assert_eq "bound-ascii-marker" "yes" "${got_marker}"
mb="$(python3 -c "print('é'*2000)")"
got="$(bound_untrusted "${mb}" 2000)"
if printf '%s' "${got}" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; then got_valid="yes"; else got_valid="no"; fi
assert_eq "bound-multibyte-valid" "yes" "${got_valid}"
assert_eq "bound-multibyte-bytes" "2034" "$(printf '%s' "${got}" | wc -c | tr -d ' ')"
assert_eq "bound-under-cap" "hello" "$(bound_untrusted "hello" 2000)"

# --- trunc_bytes ---
got="$(printf 'abcdef' | trunc_bytes 4)"
assert_eq "trunc-basic" "abcd" "${got}"
got="$(printf 'éééé' | trunc_bytes 5)"
assert_eq "trunc-multibyte-safe" "éé" "${got}"

# --- cap_file ---
t1="$(mktemp)"; printf '0123456789' > "${t1}"
cap_file "${t1}" 4
assert_eq "capfile-cuts" "0123" "$(cat "${t1}")"
t2="$(mktemp)"; printf 'abc' > "${t2}"
cap_file "${t2}" 4
assert_eq "capfile-keeps" "abc" "$(cat "${t2}")"
rm -f "${t1}" "${t2}"
if cap_file "/nonexistent-muse-test-$$" 4 2>/dev/null; then got_rc=0; else got_rc=1; fi
assert_eq "capfile-missing-rc" "1" "${got_rc}"

# --- sanitize_mentions ---
zwsp=$'\xe2\x80\x8b'
got="$(printf '%s' 'hi @octocat, ping @a-b and mail a@b.com' | sanitize_mentions)"
assert_eq "mentions-zwsp" "hi @${zwsp}octocat, ping @${zwsp}a-b and mail a@b.com" "${got}"
got="$(printf '%s' '@lead starts here' | sanitize_mentions)"
assert_eq "mentions-start" "@${zwsp}lead starts here" "${got}"

# --- redact ---
pem='-----BEGIN TEST PRIVATE KEY-----FAKEFAKEFAKE-----END TEST PRIVATE KEY-----'
assert_eq "redact-pem" "[REDACTED-PRIVATE-KEY]" "$(redact "a ${pem} b" | sed 's/^a //; s/ b$//')"
assert_eq "redact-ghp" "[REDACTED]" "$(redact 'key ghp_abc123 rest' | awk '{print $2}')"
assert_eq "redact-akid" "[REDACTED]" "$(redact 'x AKIAIOSFODNN7EXAMPLE y' | awk '{print $2}')"
assert_eq "redact-ghs" "[REDACTED]" "$(redact 'tok ghs_faketoken1 y' | awk '{print $2}')"
assert_eq "redact-ghu" "[REDACTED]" "$(redact 'tok ghu_faketoken1 y' | awk '{print $2}')"
assert_eq "redact-ghr" "[REDACTED]" "$(redact 'tok ghr_faketoken1 y' | awk '{print $2}')"
assert_eq "redact-xoxr" "[REDACTED]" "$(redact 'tok xoxr-fake1 y' | awk '{print $2}')"
assert_eq "redact-assign" 'api_key="[REDACTED]"' "$(redact 'api_key="abcDEF1234567890"')"
assert_eq "redact-token-colon" 'token: [REDACTED]' "$(redact 'token: abcDEF1234567890')"
assert_eq "redact-prose-kept" "no token here" "$(redact 'no token here')"
assert_eq "redact-model-name-kept" "muse-spark" "$(redact 'muse-spark')"
jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakesignature000'
assert_eq "redact-jwt" "[REDACTED-JWT]" "$(redact "${jwt}")"

# --- seen_add (newline-path dedup; the exact P2 scenario) ---
seen_reset
seen_add "$(printf '!x\napps/web/AGENTS.md')"
seen_add "apps/web/AGENTS.md"
assert_eq "seen-keeps-both" "2" "${#MUSE_CANDIDATES[@]}"
seen_add "apps/web/AGENTS.md"
assert_eq "seen-dedupes" "2" "${#MUSE_CANDIDATES[@]}"
seen_reset
assert_eq "seen-reset" "0" "${#MUSE_CANDIDATES[@]}"

# --- trust_base ---
assert_eq "trust-default" "true" "$(trust_base "main" "main" "true")"
assert_eq "trust-stacked" "false" "$(trust_base "feature" "main" "true")"
assert_eq "trust-nobase" "false" "$(trust_base "main" "main" "false")"
assert_eq "trust-unknown-default" "false" "$(trust_base "main" "" "true")"

# --- ranges.pl ---
diff_fix="$(mktemp)"
printf 'diff --git "a/foo\\tb.ts" "b/foo\\tb.ts"\n--- "a/foo\\tb.ts"\n+++ "b/foo\\tb.ts"\n@@ -1,3 +1,4 @@ ctx\n+x\n+++ b/forged.ts\n+y\ndiff --git a/p.ts b/p.ts\n--- a/p.ts\n+++ b/p.ts\n@@ -10 +12,2 @@\n+y\n+z\ndiff --git a/d.ts b/d.ts\n--- a/d.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\ndiff --git a/my file.ts b/my file.ts\n--- "a/my file.ts"\t\n+++ "b/my file.ts"\t\n@@ -2 +2 @@\n+z\n' > "${diff_fix}"
got="$(perl "${SCRIPT_DIR}/ranges.pl" "${diff_fix}")"
assert_eq "ranges-json" '[{"path":"foo\u0009b.ts","start":1,"end":4},{"path":"p.ts","start":12,"end":13},{"path":"my file.ts","start":2,"end":2}]' "${got}"
if printf '%s' "${got}" | jq empty 2>/dev/null; then got_jq="yes"; else got_jq="no"; fi
assert_eq "ranges-valid-json" "yes" "${got_jq}"
assert_eq "ranges-missing-file" "[]" "$(perl "${SCRIPT_DIR}/ranges.pl" "/nonexistent-muse-test-$$")"
rm -f "${diff_fix}"

# --- clean.jq + validate.jq ---
find_fix="$(mktemp)"; ranges_fix="$(mktemp)"; files_fix="$(mktemp)"
cat > "${find_fix}" <<'EOF'
{"verdict":"v","findings":[
 {"path":"a.ts","line":12,"severity":"high","title":"T1","body":"B1"},
 {"path":"a.ts","line":99,"severity":"low","title":"T2","body":"B2"},
 {"path":"a.ts","line":0,"severity":"low","title":"T3","body":"B3"},
 {"path":"nope.ts","line":0,"severity":"low","title":"T4","body":"B4"},
 {"path":"a.ts","line":"x","severity":"low","title":"BAD","body":"B"},
 {"path":7,"line":3,"severity":"low","title":"BAD2","body":"B"}
],"next_steps":[]}
EOF
printf '[{"path":"a.ts","start":10,"end":15}]' > "${ranges_fix}"
printf '[{"filename":"a.ts"}]' > "${files_fix}"
jq -f "${SCRIPT_DIR}/clean.jq" "${find_fix}" > "${find_fix}.clean" && mv "${find_fix}.clean" "${find_fix}"
assert_eq "clean-keeps-4" "4" "$(jq -r '.findings | length' "${find_fix}")"
got="$(jq --slurpfile ranges "${ranges_fix}" --slurpfile files "${files_fix}" -f "${SCRIPT_DIR}/validate.jq" "${find_fix}" | jq -c '{v:[.valid[].title],s:[.summary_only[]|{t:.title,o:(.orphaned//false)}]}')"
assert_eq "validate-split" '{"v":["T1"],"s":[{"t":"T3","o":false},{"t":"T2","o":false},{"t":"T4","o":true}]}' "${got}"
cat > "${find_fix}" <<'EOF'
{"verdict":"v","findings":[
 {"path":"a.ts","line":5,"severity":"low","title":42,"body":"B"},
 {"path":"a.ts","line":6,"severity":"low","title":"T","body":{"x":1}},
 {"path":"a.ts","line":7,"severity":"low","body":"B"},
 {"path":"","line":8,"severity":"low","title":"EMPTY","body":"B"}
],"next_steps":["ok",7,{"x":1},null]}
EOF
jq -f "${SCRIPT_DIR}/clean.jq" "${find_fix}" > "${find_fix}.clean" && mv "${find_fix}.clean" "${find_fix}"
assert_eq "clean-drops-nonstrings" '["T-less"]' "$(jq -c '[.findings[] | (.title // "T-less")]' "${find_fix}")"
assert_eq "clean-next-steps" '["ok"]' "$(jq -c '.next_steps' "${find_fix}")"
rm -f "${find_fix}" "${ranges_fix}" "${files_fix}"

# --- dedupe.jq ---
dup_fix="$(mktemp)"
cat > "${dup_fix}" <<'EOF'
[{"user":{"login":"github-actions[bot]"},"body":"<!-- muse-code-review sha:AAA base:BBB -->\nreal review"},
 {"user":{"login":"github-actions[bot]"},"body":"<!-- muse-code-review sha:AAA base:BBB -->\n<!-- muse-fallback:v1 -->\nfallback"},
 {"user":{"login":"someone"},"body":"<!-- muse-code-review sha:AAA base:BBB -->\nquoted"}]
EOF
got="$(jq -s --arg marker '<!-- muse-code-review sha:AAA base:BBB -->' -f "${SCRIPT_DIR}/dedupe.jq" "${dup_fix}")"
assert_eq "dedupe-real-only" "1" "${got}"
rm -f "${dup_fix}"

# --- schema.json ---
if jq -e '.type == "object" and .additionalProperties == false and (.required | length) == 3' "${SCRIPT_DIR}/schema.json" >/dev/null 2>&1; then got_schema="yes"; else got_schema="no"; fi
assert_eq "schema-shape" "yes" "${got_schema}"

printf '\npass=%d fail=%d%s\n' "${pass}" "${fail}" "${fail_names:+  failed:${fail_names}}"
[[ "${fail}" == "0" ]]
