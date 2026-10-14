#!/usr/bin/env bash
# Sync test: the trusted set is declared in two workflows and must stay
# identical, and every trusted pattern must be covered by the
# semgrep_relevant scope (otherwise the SAST job skips and the audit
# never runs). Fails loudly on drift so the lists cannot silently
# diverge. No third-party deps: block extraction is structural.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEC="$ROOT/.github/workflows/security.yml"
TRIP="$ROOT/.github/workflows/semgrep-tripwire.yml"

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
    if inside:
        m = re.match(r"^\s*-\s*'(.*)'\s*$", line)
        if m:
            items.append(m.group(1))
            continue
        if line.strip() and not line.lstrip().startswith("#"):
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

if [[ "$trusted" != "$trippaths" ]]; then
  echo "::error::trusted_changed (security.yml) != paths (semgrep-tripwire.yml)"
  diff <(echo "$trusted") <(echo "$trippaths") || true
  fail=1
fi

while IFS= read -r t; do
  covered=0
  while IFS= read -r r; do
    # Trusted pattern must match at least one scope pattern
    # (identical string or a covering glob like .github/workflows/**).
    case "$t" in
      $r) covered=1; break ;;
    esac
  done <<< "$relevant"
  if [[ "$covered" -eq 0 ]]; then
    echo "::error::trusted pattern '$t' not covered by semgrep_relevant"
    fail=1
  fi
done <<< "$trusted"

# The loud signal must stay loud: pin the tripwire's failing exit
# and the SAST job's advisory env. A PR that keeps the path lists
# identical while neutering either must fail here.
if ! grep -q 'exit 1' "$TRIP"; then
  echo "::error::tripwire job no longer fails; the loud signal is neutered"
  fail=1
fi
if ! grep -q "TRUSTED_CHANGE_ADVISORY: 'true'" "$SEC"; then
  echo "::error::Semgrep SAST job lost TRUSTED_CHANGE_ADVISORY=true"
  fail=1
fi

if [[ "$fail" -eq 0 ]]; then
  echo "trusted-set sync: OK ($(echo "$trusted" | wc -l) patterns, all covered)"
fi
exit "$fail"
