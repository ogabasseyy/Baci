#!/usr/bin/env bash
# Sync test: the trusted set must stay identical everywhere it is
# declared, covered by the SAST scope, and loud. Fails loudly on
# drift so the lists cannot silently diverge. No third-party deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEC="$ROOT/.github/workflows/security.yml"
TRIP="$ROOT/.github/workflows/semgrep-tripwire.yml"

# Canonical trusted set. Editing the set requires editing this pin
# (intended friction: a lockstep shrink of both workflows must fail).
CANONICAL=(
  '.github/scripts/muse-review/**'
  '.github/scripts/semgrep-sarif*'
  '.github/scripts/semgrep_sarif_*'
  '.github/workflows/security.yml'
  '.github/workflows/semgrep-tripwire.yml'
  '.github/workflows/muse-code-review.yml'
  '.github/workflows/muse-review-selftest.yml'
)

extract() { # file key -> quoted list items, one per line
  python3 - "$1" "$2" <<'EOF'
import re, sys
path, key = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
items, inside = [], False
for line in lines:
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
trusted="$(extract "$SEC" trusted_changed)"
relevant="$(extract "$SEC" semgrep_relevant)"
trippaths="$(extract "$TRIP" paths)"
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
# the tripwire's failing exit and the SAST job's advisory env.
if ! grep -q '^ *exit 1 *$' "$TRIP"; then
  echo "::error::tripwire job no longer fails; the loud signal is neutered"
  fail=1
fi
if ! grep -q "^ *TRUSTED_CHANGE_ADVISORY: 'true' *$" "$SEC"; then
  echo "::error::Semgrep SAST job lost TRUSTED_CHANGE_ADVISORY=true"
  fail=1
fi

if [[ "$fail" -eq 0 ]]; then
  echo "trusted-set sync: OK (${#CANONICAL[@]} canonical patterns, all covered)"
fi
exit "$fail"
