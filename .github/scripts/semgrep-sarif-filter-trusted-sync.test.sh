#!/usr/bin/env bash
# Sync test: the trusted set must stay identical everywhere it is
# declared, covered by the SAST scope, and loud. Fails loudly on
# drift so the lists cannot silently diverge. No third-party deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEC="$ROOT/.github/workflows/security.yml"
TRIP="$ROOT/.github/workflows/semgrep-tripwire.yml"

# Canonical trusted set. Editing the set requires editing this pin
# (intended friction: an accidental edit to one list but not the
# others fails). This runs from the PR head, so a deliberate
# same-diff shrink of both workflows AND this pin would pass —
# that forgery is PR-controlled like the rest of the signal, with
# CODEOWNERS review on .github/** as the backstop; a base-owned
# gate is tracked in #3622.
CANONICAL=(
  '.github/scripts/muse-review/**'
  '.github/scripts/semgrep-sarif*'
  '.github/scripts/semgrep_sarif_*'
  '.github/workflows/security.yml'
  '.github/workflows/semgrep-tripwire.yml'
  '.github/workflows/muse-code-review.yml'
  '.github/workflows/muse-review-selftest.yml'
  '.github/CODEOWNERS'
)

extract() { # file key [parent] -> quoted list items, one per line
  python3 - "$1" "$2" "${3-}" <<'EOF'
import re, sys
path, key, parent = sys.argv[1], sys.argv[2], sys.argv[3] or None
lines = open(path).read().splitlines()
items, inside = [], False
parent_indent = None
for line in lines:
    if parent and parent_indent is None:
        m_parent = re.match(rf"^(\s*){re.escape(parent)}:\s*$", line)
        if not m_parent:
            continue
        parent_indent = len(m_parent.group(1))
        continue
    if parent:
        stripped_line = line.strip()
        indent = len(line) - len(line.lstrip())
        if stripped_line and not stripped_line.startswith("#") \
                and indent <= parent_indent:
            parent_indent = None
            inside = False
            continue
    if re.match(rf"^\s*{re.escape(key)}:\s*$", line):
        inside = True
        continue
    if not inside:
        continue
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        continue
    m = re.match(r"^-\s*'(.*)'\s*$", stripped) or \
        re.match(r'^-\s*"(.*)"\s*$', stripped)
    if m:
        items.append(m.group(1))
        continue
    if re.match(r"^-\s*\w+\s*:", stripped):
        break  # sequence mapping (- name:) ends the scalar list
    if stripped.startswith("-"):
        sys.exit(f"unrecognized list item under {key} in {path}: {stripped!r} "
                 f"(quote it and extend this extractor)")
    break
if not items:
    sys.exit(f"no items found under {key} in {path}")
print("\n".join(items))
EOF
}

fail=0
# Graceful extraction: a missing/unreadable list reports its own
# error and lets the remaining pins run, instead of aborting before
# the specific pin (e.g. the trigger check) can diagnose the cause.
trusted="$(extract "$SEC" trusted_changed 2>/dev/null)" \
  || { echo "::error::could not read trusted_changed list from $SEC"; fail=1; trusted=""; }
relevant="$(extract "$SEC" semgrep_relevant 2>/dev/null)" \
  || { echo "::error::could not read semgrep_relevant list from $SEC"; fail=1; relevant=""; }
# Scoped to on.pull_request.paths: an unscoped first-`paths:` match
# would accept the canonical list under a push event while PRs use
# a narrower list and never fire the tripwire.
trippaths="$(extract "$TRIP" paths pull_request 2>/dev/null)" \
  || { echo "::error::could not read pull_request paths from $TRIP"; fail=1; trippaths=""; }
canonical="$(printf '%s\n' "${CANONICAL[@]}")"

for name in trusted trippaths; do
  if [[ "$(echo "${!name}" | sort)" != "$(echo "$canonical" | sort)" ]]; then
    echo "::error::$name does not match the canonical trusted set"
    diff <(echo "$canonical" | sort) <(echo "${!name}" | sort) || true
    fail=1
  fi
done

# Coverage with picomatch-subset semantics (dorny/paths-filter):
# `*` must not cross `/`. Each trusted pattern contributes
# representative paths (nested included); every one must match at
# least one scope pattern. Unsupported glob syntax fails loudly.
export trusted relevant
if ! python3 - <<'EOF'; then
import fnmatch, os, re, sys

def translate(pat):
    for ch in ("[", "{", "!", "(", ")"):
        if ch in pat:
            sys.exit(f"unsupported glob syntax in {pat!r}; extend the matcher")
    out, i = "", 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out += "(.*/)?"
            i += 3
        elif pat.startswith("**", i):
            out += ".*"
            i += 2
        elif pat[i] == "*":
            out += "[^/]*"
            i += 1
        elif pat[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pat[i])
            i += 1
    return re.compile("^" + out + "$")

def representatives(pat):
    if "**" in pat:
        base = pat.split("**")[0].rstrip("/")
        return [f"{base}/a.sh", f"{base}/a/b/c.sh"]
    if "*" in pat or "?" in pat:
        # Same-segment instantiation (`*` never crosses `/`, so no
        # nested representative: the pattern itself cannot match one).
        return [pat.replace("*", "zzz").replace("?", "z")]
    return [pat]

trusted = os.environ["trusted"].splitlines()
relevant = [translate(p) for p in os.environ["relevant"].splitlines()]
failed = False
for t in trusted:
    for rep in representatives(t):
        if not any(r.match(rep) for r in relevant):
            print(f"::error::trusted pattern {t!r} not covered "
                  f"(representative {rep!r} matches no scope pattern)")
            failed = True
sys.exit(1 if failed else 0)
EOF
  fail=1
fi

# The loud signal must stay loud: anchored (comment-proof) pins on
# the tripwire's failing exit, its pull_request trigger, and the
# SAST job's advisory env.
if ! grep -q '^ *exit 1 *$' "$TRIP"; then
  echo "::error::tripwire job no longer fails; the loud signal is neutered"
  fail=1
fi
# Reachability: an `exit 1` that never executes (e.g. an `exit 0`
# inserted above it) is no loud signal. The tripwire must contain
# exactly one exit line, and it must be `exit 1`.
if [[ "$(grep -cE '^[[:space:]]*exit([[:space:]]|$)' "$TRIP")" -ne 1 ]]; then
  echo "::error::tripwire must contain exactly one exit line so the failure is reachable"
  fail=1
fi
# `if:` or `continue-on-error:` anywhere in the tripwire would let it
# report skipped/success while every pin above stays green. This file
# is ~30 lines whose only job is to fail; neither key has a
# legitimate use here, so both are banned outright.
if grep -Eq '^[[:space:]]*if:' "$TRIP" \
  || grep -Eq '^[[:space:]]*continue-on-error:' "$TRIP"; then
  echo "::error::tripwire must not carry if:/continue-on-error; the loud signal must fire unconditionally"
  fail=1
fi
if ! grep -q '^  pull_request:$' "$TRIP" \
  || ! grep -q '^    branches: \[main, develop\]$' "$TRIP"; then
  echo "::error::tripwire lost its pull_request trigger on main/develop"
  fail=1
fi
if ! grep -q "^ *TRUSTED_CHANGE_ADVISORY: 'true' *$" "$SEC"; then
  echo "::error::Semgrep SAST job lost TRUSTED_CHANGE_ADVISORY=true"
  fail=1
fi

# The real-findings gate depends on both scan --error flags and the
# outcome-based final step: pin both so neither can silently revert.
if [[ "$(grep -c 'semgrep scan --error' "$SEC")" -ne 2 ]]; then
  echo "::error::expected 2 semgrep scan --error invocations in $SEC"
  fail=1
fi
fail_if="$(awk '/- name: Fail on Semgrep findings or scanner errors/{getline; print}' "$SEC")"
fail_run="$(awk '/- name: Fail on Semgrep findings or scanner errors/{getline; getline; print}' "$SEC")"
for scan in semgrep_pr semgrep_push semgrep_full; do
  if [[ "$fail_if" != *"steps.${scan}.outcome == 'failure'"* ]]; then
    echo "::error::final gate lost the ${scan} outcome disjunct"
    fail=1
  fi
done
if [[ "$fail_if" == *"sarif_exists"* ]]; then
  echo "::error::final gate must key on scan outcomes without a SARIF guard"
  fail=1
fi
# The gate must actually fail: pin `run: exit 1` as the step body and
# ban failure suppression anywhere in the step block (a `run: true`
# swap or continue-on-error would otherwise keep the required gate
# green while scans report failure).
if ! grep -Eqx '[[:space:]]*run:[[:space:]]*exit 1[[:space:]]*' <<<"$fail_run"; then
  echo "::error::final gate step body must be exactly 'run: exit 1'"
  fail=1
fi
gate_block="$(awk '/- name: Fail on Semgrep findings/{on=1} on{print} on&&/^      - name: /&&!/Fail on Semgrep/{exit} on&&/^  [a-z_]/{exit}' "$SEC")"
if grep -Eq '^[[:space:]]*continue-on-error:' <<<"$gate_block"; then
  echo "::error::final gate step must not carry continue-on-error"
  fail=1
fi

if [[ "$fail" -eq 0 ]]; then
  echo "trusted-set sync: OK (${#CANONICAL[@]} canonical patterns, all covered)"
fi
exit "$fail"
