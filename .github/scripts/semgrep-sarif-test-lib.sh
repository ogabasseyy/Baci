#!/usr/bin/env bash
# shellcheck disable=SC2034 # constants consumed by sourcing suites
# Shared harness for the SARIF drift-auditor regression suites.
# Sourced (not executed) by semgrep-sarif-filter.test.sh and
# semgrep-sarif-hardening.test.sh: fixtures, mutation applier,
# and the black-box `t` runner. See filter.test.sh for the model.
#
# Black-box: copies .github into a scratch tree, applies one mutation,
# runs semgrep-sarif-filter.py there, and asserts the exit code, the
# drift label (or notice/warning), and sometimes the SARIF result count.
# Runs with bash 3.2+ (macOS) and bash 5 (CI): no associative arrays,
# no mapfile. No network, no repo state, deterministic. Fixture line
# numbers derive from the tree (grep), never hardcoded.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILTER="$ROOT/.github/scripts/semgrep-sarif-filter.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
YML='.github/workflows/muse-code-review.yml'
RUNSH='.github/scripts/muse-review/run.sh'
INST='.github/scripts/muse-review/install.sh'

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

# --- SARIF fixtures (span probes derive from the pristine tree) ---
REF_LINE="$(grep -n 'ref: ${{ github.event.pull_request.head.sha }}' "$ROOT/$YML" | cut -d: -f1)"
NEXT_STEP="$(awk -v r="$REF_LINE" 'NR>r && /^      - name:/{print NR; exit}' "$ROOT/$YML")"
SPAN_END="$(awk -v r="$REF_LINE" -v n="$NEXT_STEP" 'NR>r && NR<n && NF{last=NR} END{print last}' "$ROOT/$YML")"
SPAN_OUT=$(( SPAN_END + 1 ))
assert_eq "fixture-span-out-blank" "" "$(sed -n "${SPAN_OUT}p" "$ROOT/$YML")"
mksarif() {
  python3 - "$WORK/$1" "$2" "$3" <<'EOF'
import json, sys
path, sl, sup = sys.argv[1], int(sys.argv[2]), sys.argv[3]
RULE = ("yaml.github-actions.security.pull-request-target-code-checkout"
        ".pull-request-target-code-checkout")
def R(rule, uri, line, s):
    r = {"ruleId": rule, "locations": [{"physicalLocation":
        {"artifactLocation": {"uri": uri}, "region": {"startLine": line}}}]}
    if s:
        r["suppressions"] = json.loads(s)
    return r
results = [R(RULE, ".github/workflows/muse-code-review.yml", sl, sup),
           R("javascript.lang.security.audit.probe", "apps/web/probe.ts", 5, "")]
json.dump({"version": "2.1.0", "runs": [{"tool": {"driver": {"name": "semgrep"}},
          "results": results}]}, open(path, "w"))
EOF
}
SUP='[{"kind":"inSource","justification":"audited safe"}]'
mksarif happy.sarif "$REF_LINE" "$SUP"
mksarif span-end.sarif "$SPAN_END" "$SUP"
mksarif span-out.sarif "$SPAN_OUT" "$SUP"
mksarif shape.sarif "$REF_LINE" ""
printf '{invalid json' > "$WORK/corrupt.sarif"

# --- mutation applier ---
# Spec: file \x1f anchor [\x1f mode [\x1f payload [\x1f payload2]]].
# Anchor may carry an N: occurrence prefix (2nd persist-credentials etc).
# Modes: a/b=insert line after/before anchor, d=delete anchor line,
# r=replace payload with payload2 inside anchor line, rm=delete
# file, new:create file with payload, none=no-op.
# Multiple ops join with \x1e. Unknown anchors fail the case loudly.
apply_op() {
  python3 - "$WORK" "$1" <<'EOF'
import os, sys
work, spec = sys.argv[1], sys.argv[2]
for op in spec.split("\x1e"):
    if op == "none":
        continue
    if op.startswith("rm:"):
        os.remove(work + "/" + op[3:])
        continue
    if op.startswith("new:"):
        path, payload = op[4:].split("\x1f", 1)
        open(work + "/" + path, "w").write(payload + "\n")
        continue
    parts = (op.split("\x1f") + ["", "", "", ""])[:5]
    path, anchor, mode, payload, payload2 = parts
    occ = 1
    if ":" in anchor and anchor.split(":")[0].isdigit():
        occ, anchor = anchor.split(":", 1)
        occ = int(occ)
    fp = work + "/" + path
    text = open(fp).read().split("\n")
    idx = [i for i, l in enumerate(text) if anchor in l]
    if len(idx) < occ:
        raise SystemExit("anchor %r x%d missing in %s" % (anchor, occ, path))
    i = idx[occ - 1]
    if mode == "a":
        text.insert(i + 1, payload)
    elif mode == "b":
        text.insert(i, payload)
    elif mode == "d":
        del text[i]
    elif mode == "r":
        if payload not in text[i]:
            raise SystemExit("old %r missing in anchor line" % payload)
        text[i] = text[i].replace(payload, payload2, 1)
    else:
        raise SystemExit("bad mode %r" % mode)
    open(fp, "w").write("\n".join(text))
EOF
}

# t name expect_exit expect_label sarif op [expect_remaining] [trusted_changed]
t() {
  rm -rf "$WORK/.github" "$WORK/semgrep.sarif"
  cp -r "$ROOT/.github" "$WORK/.github"
  if [[ "$4" != "absent" ]]; then cp "$WORK/$4" "$WORK/semgrep.sarif"; fi
  if ! apply_op "$5"; then
    fail=$(( fail + 1 ))
    fail_names="${fail_names} $1-op"
    printf 'FAIL %s\n  op failed to apply\n' "$1"
    return
  fi
  if [[ -n "${7:-}" ]]; then export TRUSTED_CHANGED="$7"; else unset TRUSTED_CHANGED; fi
  out="$(cd "$WORK" && python3 "$FILTER" 2>&1)"
  code="$?"
  unset TRUSTED_CHANGED
  assert_eq "$1-exit" "$2" "$code"
  case "$out" in *"$3"*) got="yes";; *) got="no";; esac
  assert_eq "$1-label" "yes" "$got"
  if [[ -n "${6:-}" && -f "$WORK/semgrep.sarif" ]]; then
    got="$(python3 -c "import json;print(len(json.load(open('$WORK/semgrep.sarif'))['runs'][0]['results']))")"
    assert_eq "$1-remaining" "$6" "$got"
  fi
}
S="$YML"
R="$RUNSH"
I="$INST"
H='.github/scripts/muse-review/collect.sh'
P='.github/scripts/muse-review/ranges.pl'
C='.github/scripts/muse-review/clean.jq'
FS=$'\x1f'
RS=$'\x1e'
