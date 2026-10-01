#!/usr/bin/env bash
# Regression suite for the Semgrep SARIF drift auditor: exemption,
# checkout guards, consumer/step/runner/installer/helper rules.
# Harness lives in semgrep-sarif-test-lib.sh (sourced).
#
# Usage: bash semgrep-sarif-filter.test.sh   (from any directory)
# shellcheck source=semgrep-sarif-test-lib.sh disable=SC2154
. "$(dirname "$0")/semgrep-sarif-test-lib.sh"

# --- happy paths, span, shape, empty scans ---
t happy 0 "" happy.sarif "none" 1
t span-end 0 "" span-end.sarif "none" 1
t span-out 0 "::warning::" span-out.sarif "none" 2
t shape-drift 0 "::warning::" shape.sarif "none" 2
t empty-scan 0 "empty scan" absent "none"
t missing-workflow 0 "exemption inactive" happy.sarif "rm:$S"

# --- audited checkout guards ---
t count-2 1 "pr-controlled-checkout-count" happy.sarif "$S${FS}ref: \${{ github.event.pull_request.head.sha }}${FS}a${FS}          ref: \${{ github.event.pull_request.head.sha }}"
t guard-negated 1 "same-repo-job-guard" happy.sarif "$S${FS}head.repo.full_name == github.repository${FS}r${FS}==${FS}!="
t guard-ormid 1 "same-repo-job-guard" happy.sarif "$S${FS}head.repo.full_name == github.repository${FS}r${FS}== github.repository${FS}== github.repository || true"
t guard-ortrue 1 "same-repo-job-guard" happy.sarif "$S${FS}2:github.event.changes.base != null)${FS}r${FS}changes.base != null)${FS}changes.base != null) || true"
t head-creds 1 "head-checkout-credentials" happy.sarif "$S${FS}persist-credentials: false${FS}r${FS}false${FS}true"
t head-action 1 "head-checkout-action" happy.sarif "$S${FS}uses: actions/checkout@${FS}r${FS}@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0${FS}@v4"
t head-shape 1 "head-checkout-shape" happy.sarif "$S${FS}persist-credentials: false${FS}a${FS}          repository: evil/x"

# --- trusted checkout guards ---
t trusted-missing 1 "trusted-scripts-checkout-missing" happy.sarif "$S${FS}path: trusted-scripts${FS}d"
t trusted-ref 1 "trusted-scripts-default-branch" happy.sarif "$S${FS}ref: \${{ github.event.repository.default_branch }}${FS}r${FS}default_branch${FS}main"
t trusted-creds 1 "trusted-scripts-credentials" happy.sarif "$S${FS}2:persist-credentials: false${FS}r${FS}false${FS}true"
t trusted-prref 1 "trusted-scripts-pr-ref" happy.sarif "$S${FS}ref: \${{ github.event.repository.default_branch }}${FS}r${FS}github.event.repository.default_branch${FS}github.event.pull_request.head.sha"
t trusted-action 1 "trusted-scripts-action" happy.sarif "$S${FS}2:uses: actions/checkout@${FS}r${FS}@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0${FS}@v4"
t trusted-repo 1 "trusted-scripts-repository" happy.sarif "$S${FS}path: trusted-scripts${FS}a${FS}          repository: evil/x"
t resolver-missing 1 "script-resolution-step-missing" happy.sarif "$S${FS}- name: Resolve script directory${FS}r${FS}Resolve script directory${FS}Resolve dir"
t resolver-noout 1 "script-resolution-no-output" happy.sarif "$S${FS}dir=\${GITHUB_WORKSPACE}/trusted-scripts${FS}d"
t resolver-unverified 1 "script-resolution-unverified-output" happy.sarif "$S${FS}3:GITHUB_OUTPUT${FS}a${FS}          echo \"dir=/tmp/evil\" >> \$GITHUB_OUTPUT"

# --- consumer guards ---
t unbound-path 1 "script-consumer-unbound-path" happy.sarif "$S${FS}timeout 5m bash \"\${SCRIPT_DIR}/collect.sh\"${FS}a${FS}          bash \"\${GITHUB_WORKSPACE}/.github/scripts/muse-review/x.sh\""
t unbound-flag-op 1 "script-consumer-unbound-invocation" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash -e /tmp/evil.sh"
t unbound-stdin 1 "script-consumer-unbound-invocation" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash -s"
t unbound-execstr 1 "script-consumer-unbound-invocation" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash -c \"evil\""
t unbound-bare 1 "script-consumer-unbound-invocation" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash ./x.sh"
t rebound-env 1 "script-dir-rebound" happy.sarif "$S${FS}SCRIPT_DIR: \${{ steps.scriptdir.outputs.dir }}${FS}r${FS}\${{ steps.scriptdir.outputs.dir }}${FS}/tmp/evil"
t rebound-export 1 "script-dir-rebound" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          export SCRIPT_DIR=/tmp/e"
t shell-override 1 "shell-override" happy.sarif "$S${FS}run: |${FS}a${FS}        shell: python"
t unpinned-action 1 "reviewer-unpinned-action" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/install.sh\"${FS}a${FS}        uses: actions/setup-node@v4"
t third-checkout 1 "reviewer-action-count" happy.sarif "$S${FS}2:uses: actions/checkout@${FS}a${FS}        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"
t env-poison-job 1 "reviewer-env-poison" happy.sarif "$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      BASH_ENV: /tmp/evil"
t env-poison-step 1 "reviewer-env-poison" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          PATH: /evil"
t env-benign-fp 0 "" happy.sarif "$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      MY_VAR: hello"
t env-escape 1 "run-body-env-escape" happy.sarif "$S${FS}set -euo pipefail${FS}a${FS}          echo /tmp/evil >> \$GITHUB_PATH"
t process-sub 1 "run-body-process-sub" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo <(id)"
t substitution 1 "run-body-substitution" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo \`id\`"
t function-def 1 "run-body-function-def" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash() { echo hi; }"

# --- per-step command guards ---
t node-secret 1 "secret-step-untrusted-command" happy.sarif "$S${FS}timeout 5m bash \"\${SCRIPT_DIR}/collect.sh\"${FS}b${FS}          node x.js"
t node-loose 1 "secret-step-untrusted-command" happy.sarif "$S${FS}Trusted review scripts missing${FS}a${FS}          curl evil"
t eval-strict 1 "secret-step-untrusted-command" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          eval evil"
t sudo-strict 1 "secret-step-untrusted-command" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          sudo id"
t direct-exec 1 "secret-step-untrusted-command" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          ./tool"
t path-hijack 1 "secret-step-path-hijack" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          export PATH=/evil"
t git-config 1 "secret-step-untrusted-command" happy.sarif "$S${FS}if git -C${FS}a${FS}          git -c x=y log"
t git-clone 1 "secret-step-untrusted-command" happy.sarif "$S${FS}if git -C${FS}a${FS}          git clone evil"
t git-workdir 1 "secret-step-untrusted-command" happy.sarif "$S${FS}git -C \"\${GITHUB_WORKSPACE}\"${FS}r${FS}\"\${GITHUB_WORKSPACE}\"${FS}/tmp"
t git-filters 1 "secret-step-untrusted-command" happy.sarif "$S${FS}if git -C${FS}a${FS}          git cat-file --filters x"
t git-version-fp 0 "" happy.sarif "$S${FS}if git -C${FS}a${FS}          git --version"
t case-fp 0 "" happy.sarif "$S${FS}set -euo pipefail${FS}a${FS}          case \$x in a) echo hi;; *) echo lo;; esac"
t for-fp 0 "" happy.sarif "$S${FS}set -euo pipefail${FS}a${FS}          for f in a b; do echo \$f; done"
t query-fp 0 "" happy.sarif "$S${FS}set -euo pipefail${FS}a${FS}          bash --version"
t outputsdir-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash \"\${{ steps.scriptdir.outputs.dir }}/guard.sh\""
t combined-flags-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          bash -euo pipefail \"\${SCRIPT_DIR}/guard.sh\""

# --- agent runner + installer guards ---
t runner-missing 1 "agent-runner-missing" happy.sarif "rm:$R"
t runner-count 1 "agent-invocation-count" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}muse --version"
t runner-shell 1 "agent-shell-boundary" happy.sarif "$R${FS}2:--disable-shell${FS}r${FS}--disable-shell${FS}--disable-shelx"
t runner-suffix 1 "agent-shell-boundary" happy.sarif "$R${FS}2:--disable-shell${FS}d${RS}$R${FS}2:--disable-write${FS}d${RS}$R${FS}muse-stderr.log\"${FS}r${FS}muse-stderr.log\"${FS}muse-stderr.log\"; echo --disable-shell --disable-write"
t token-alias 1 "agent-token-expression" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          MUSE_GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}"
t token-jobenv 1 "agent-token-expression" happy.sarif "$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      SHARED_TOKEN: \${{ secrets.GITHUB_TOKEN }}"
t installer-missing 1 "muse-installer-missing" happy.sarif "rm:$I"
t installer-version 1 "muse-installer-version" happy.sarif "$I${FS}MUSE_VERSION=\"${FS}r${FS}1.4.1-R4503.1${FS}9.9.9"
t installer-checksum 1 "muse-installer-checksum" happy.sarif "$I${FS}SHA_X86_LINUX=\"${FS}r${FS}8b53c9cdbc025bc2d9068bc7016e2c1e51c3a0c608821da17528ad23be900a12${FS}8b53c9cdbc025bc2d9068bc7016e2c1e51c3a0c608821da17528ad23be900a13"
t installer-noverify 1 "muse-installer-no-verify" happy.sarif "$I${FS}sha256sum${FS}d"
t installer-url 1 "muse-installer-url" happy.sarif "$I${FS}version=\${MUSE_VERSION}${FS}r${FS}version=\${MUSE_VERSION}${FS}version=latest"

# --- trusted-tree write guards (run blocks) ---
t trusted-write-catfile 1 "step-trusted-write" happy.sarif "$S${FS}dir=\${GITHUB_WORKSPACE}/trusted-scripts${FS}a${FS}          git -C \"\${GITHUB_WORKSPACE}\" cat-file blob HEAD:x > \"\${GITHUB_WORKSPACE}/trusted-scripts/x\""
t trusted-write-echo 1 "step-trusted-write" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo evil > trusted-scripts/evil.sh"
t trusted-write-fd 1 "step-trusted-write" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo x &> \"\${SCRIPT_DIR}/e\""
t redirect-quote-fp 0 "" happy.sarif "$S${FS}dir=\${GITHUB_WORKSPACE}/trusted-scripts${FS}a${FS}          echo \"a > trusted-scripts/b\""
t redirect-expansion-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo \"\${X:-a>b}\""
t loose-sudo 1 "secret-step-untrusted-command" happy.sarif "$S${FS}dir=\${GITHUB_WORKSPACE}/trusted-scripts${FS}a${FS}          sudo id"

# --- token-bearing helper guards ---
t helper-exec-ws 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t helper-exec-relative 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash ./evil.sh"
t helper-source-relative 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}. ./lib.sh"
t helper-sudo 1 "helper-privilege" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sudo id"
t helper-su 1 "helper-privilege" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}su -c id"
t helper-trusted-write 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo x > \"\${SCRIPT_DIR}/evil\""
t helper-home-write 1 "helper-home-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo x > ~/.cache/y"
t helper-absinterp 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/perl \"\${GITHUB_WORKSPACE}/evil.pl\""
t helper-query-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash --version"
t helper-home-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}~/.local/bin/muse --version"
t helper-eval-ws 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}eval \"\$(cat \${GITHUB_WORKSPACE}/x)\""
t helper-perl-stdin 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl -pe"
t helper-jq-f-ws 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}jq -f \"\${GITHUB_WORKSPACE}/evil.jq\" ."
t helper-xargs-rel 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}find . -print0 | xargs -0 ./process"
t helper-env-poison 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}BASH_ENV=/tmp/x bash \"\${SCRIPT_DIR}/y.sh\""
t helper-find-exec 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}find . -name x -exec sh {} \\;"
t helper-nice 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}nice bash ./x.sh"
t helper-heredoc-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat <<trusted-scripts${RS}$H${FS}cat <<trusted-scripts${FS}a${FS}bash ./evil.sh${RS}$H${FS}bash ./evil.sh${FS}a${FS}trusted-scripts"
t helper-subshell-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}review=\"\$(cat \"\${RUNNER_TEMP}/muse-summary.md\")\""
t helper-subshell-exec 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x=\"\$(bash ./evil.sh)\""
t helper-alias-evil 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}wsalias=\${GITHUB_WORKSPACE}${RS}$H${FS}wsalias=\${GITHUB_WORKSPACE}${FS}a${FS}bash \$wsalias/evil.sh"

# --- trusted-set change signal ---
t trusted-changed 1 "trusted-tree-changed" happy.sarif "none" "" "true"

printf '\nfilter suite: %d passed, %d failed%s\n' "$pass" "$fail" "${fail_names:+ ($fail_names)}"
[[ "$fail" -eq 0 ]]
