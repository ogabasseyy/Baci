#!/usr/bin/env bash
# Negative regressions for the trusted-set sync test. Every mutation
# below weakens one pinned behavior and MUST make the sync test fail
# with the expected error; a mutation the sync test passes is a dead
# pin. Each case runs against a temp copy of .github (the sync test
# resolves paths from its own location). No third-party deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SYNC=".github/scripts/semgrep-sarif-filter-trusted-sync.test.sh"
SEC=".github/workflows/security.yml"
TRIP=".github/workflows/semgrep-tripwire.yml"

# sub FILE OLD NEW: replace the first occurrence of OLD with NEW.
# python3 (not sed -i) so this runs on macOS and Linux alike.
sub() {
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) >= 1, f"pattern not found in {p}: {old!r}"
open(p, "w").write(s.replace(old, new, 1))
EOF
}

pass=0; fail=0
neg() { # name expected-error-substring mutator-fn
  local name="$1" want="$2" mut="$3" tmp
  tmp="$(mktemp -d)"
  cp -r "$ROOT/.github" "$tmp/"
  ( cd "$tmp" && "$mut" ) || { echo "MUTATOR-FAILED: $name"; fail=$((fail + 1)); rm -rf "$tmp"; return 0; }
  if ( cd "$tmp" && bash "$SYNC" >"$tmp/out.log" 2>&1 ); then
    echo "NOT-FAILED (dead pin): $name"
    fail=$((fail + 1))
  elif grep -qF "$want" "$tmp/out.log"; then
    echo "ok: $name"
    pass=$((pass + 1))
  else
    echo "WRONG-ERROR: $name (wanted substring: $want)"
    cat "$tmp/out.log"
    fail=$((fail + 1))
  fi
  rm -rf "$tmp"
}

COE=$'\n        continue-on-error: true'
NL_IF_FALSE=$'    permissions: {}\n    if: false'
NL_EXIT0=$'          exit 0\n          exit 1'
NL_GATE_COE=$'        run: exit 1\n        continue-on-error: true'
m_trusted_renamed() { sub "$SEC" "- '.github/workflows/muse-code-review.yml'" "- '.github/workflows/muse-code-review.yml.bak'"; }
m_trippath_renamed() { sub "$TRIP" "- '.github/workflows/muse-code-review.yml'" "- '.github/workflows/muse-code-review.yml.bak'"; }
m_canonical_renamed() { sub "$SYNC" "  '.github/workflows/muse-code-review.yml'" "  '.github/workflows/muse-code-review.yml.bak'"; }
m_relevant_renamed() { sub "$SEC" "              - '.github/CODEOWNERS'" "              - '.github/CODEOWNERS.bak'"; }
m_trip_exit_removed() { sub "$TRIP" "          exit 1" "          true"; }
m_trip_if_false() { sub "$TRIP" "    permissions: {}" "$NL_IF_FALSE"; }
m_trip_coe() { sub "$TRIP" "      - name: Flag trusted-tree change" "      - name: Flag trusted-tree change$COE"; }
m_trip_early_exit0() { sub "$TRIP" "          exit 1" "$NL_EXIT0"; }
m_trip_exit0_swap() { sub "$TRIP" "          exit 1" "          exit 0"; }
m_scan_error_dropped() { sub "$SEC" "semgrep scan --error" "semgrep scan"; }
m_text_output_dropped() { sub "$SEC" " --text-output=/dev/stdout" ""; }
m_bare_text_added() { sub "$SEC" "--sarif --output=semgrep.sarif --text-output=/dev/stdout" "--sarif --output=semgrep.sarif --text --text-output=/dev/stdout"; }
m_prune_readded() { sub "$SEC" "fetch --no-tags origin" "fetch --no-tags --prune origin"; }
m_exit1_removed() { sub "$SEC" 'failing closed instead of skipping the scan."; exit 1' 'failed."'; }
m_gate_disjuncts_dropped() { sub "$SEC" " || steps.semgrep_push.outcome == 'failure' || steps.semgrep_full.outcome == 'failure'" ""; }
m_gate_run_true() { sub "$SEC" "run: exit 1" "run: true"; }
m_gate_coe() { sub "$SEC" "        run: exit 1" "$NL_GATE_COE"; }
m_trigger_push_swap() { sub "$TRIP" "  pull_request:" "  push:"; }
m_trusted_block_deleted() { sub "$SEC" "            trusted_changed:" "            trusted_changed_deleted:"; }
m_advisory_dropped() { sub "$SEC" "TRUSTED_CHANGE_ADVISORY: 'true'" "TRUSTED_CHANGE_ADVISORY: 'false'"; }
m_push_decoy() {
  python3 - "$TRIP" <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
canon = """  push:
    branches: [main, develop]
    paths:
      - '.github/scripts/muse-review/**'
      - '.github/scripts/semgrep-sarif*'
      - '.github/scripts/semgrep_sarif_*'
      - '.github/workflows/security.yml'
      - '.github/workflows/semgrep-tripwire.yml'
      - '.github/workflows/muse-code-review.yml'
      - '.github/workflows/muse-review-selftest.yml'
      - '.github/CODEOWNERS'
"""
head, sep, tail = s.partition("  pull_request:\n")
assert sep, "pull_request block not found"
tail = tail.replace("      - '.github/scripts/muse-review/**'\n", "")
open(p, "w").write(head + canon + sep + tail)
EOF
}

neg "trusted-entry-renamed" "does not match the canonical trusted set" m_trusted_renamed
neg "tripwire-path-renamed" "does not match the canonical trusted set" m_trippath_renamed
neg "canonical-entry-renamed" "does not match the canonical trusted set" m_canonical_renamed
neg "relevant-entry-renamed" "matches no scope pattern" m_relevant_renamed
neg "tripwire-exit-removed" "no longer fails" m_trip_exit_removed
neg "tripwire-if-false" "must not carry if" m_trip_if_false
neg "tripwire-continue-on-error" "must not carry if" m_trip_coe
neg "tripwire-early-exit-0" "exactly one exit line" m_trip_early_exit0
neg "tripwire-exit-0-swap" "no longer fails" m_trip_exit0_swap
neg "scan-error-dropped" "expected 2 semgrep scan --error" m_scan_error_dropped
neg "text-output-dropped" "expected 3 --text-output" m_text_output_dropped
neg "bare-text-added" "breaks --sarif scans" m_bare_text_added
neg "prune-readded" "must not appear" m_prune_readded
neg "failclosed-exit-removed" "must exit nonzero" m_exit1_removed
neg "gate-disjuncts-dropped" "lost the semgrep_push outcome disjunct" m_gate_disjuncts_dropped
neg "gate-run-true" "must be exactly 'run: exit 1'" m_gate_run_true
neg "gate-continue-on-error" "must not carry continue-on-error" m_gate_coe
neg "push-paths-decoy" "does not match the canonical trusted set" m_push_decoy
neg "trigger-push-swap" "lost its pull_request trigger" m_trigger_push_swap
neg "trusted-block-deleted" "could not read trusted_changed" m_trusted_block_deleted
neg "advisory-dropped" "lost TRUSTED_CHANGE_ADVISORY" m_advisory_dropped

echo "sync negatives: $pass passed, $fail failed"
exit "$((fail > 0))"
