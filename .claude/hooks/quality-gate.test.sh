#!/bin/bash
# Tests for quality-gate.sh session scoping. Run: bash .claude/hooks/quality-gate.test.sh
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
T=$(cd -P "$(mktemp -d)" && pwd); trap 'rm -rf "$T"' EXIT
unset QUALITY_GATE_SKIP_DEPS
export HOME="$T/home"; mkdir -p "$HOME/.codex/worktrees"
fail() { echo "FAIL: $*" >&2; exit 1; }

R="$T/repo"; git init -q "$R"; git -C "$R" -c user.email=a@b -c user.name=t commit -q --allow-empty -m init
git -C "$R" update-ref refs/remotes/origin/main HEAD
git -C "$R" worktree add -q "$T/wtA" -b a
git -C "$R" worktree add -q "$T/wtB" -b b
git -C "$R" worktree add -q "$HOME/.codex/worktrees/codex1" -b c
echo dirty > "$T/wtA/x"; echo dirty > "$T/wtB/x"; echo dirty > "$HOME/.codex/worktrees/codex1/x"

# Stub checker: records which worktrees it was asked to check; blocks if x says "bad".
cat > "$T/checker.sh" <<'EOS'
#!/bin/bash
echo "$1" >> "$CHECK_LOG"
grep -q bad "$1/x" 2>/dev/null && { echo "blocked $1"; exit 1; }
exit 0
EOS
chmod +x "$T/checker.sh"
export QUALITY_GATE_CHECK_SCRIPT="$T/checker.sh" CHECK_LOG="$T/log" CLAUDE_PROJECT_DIR="$R"

run_gate() { # $1 = transcript lines file
  : > "$CHECK_LOG"
  printf '{"transcript_path":"%s","cwd":"%s"}' "$1" "$R" | bash "$HOOK_DIR/quality-gate.sh" 2>/dev/null
}
# tool <input-json> [name] [cwd]: one transcript line (cwd defaults to the main checkout)
tool() { jq -nc --argjson i "$1" --arg n "${2:-$(jq -r "if has(\"file_path\") then \"Edit\" else \"Bash\" end" <<<"$1")}" --arg c "${3:-$R}" '{type:"assistant",cwd:$c,message:{content:[{type:"tool_use",name:$n,input:$i}]}}'; }

# 1. cd into worktree A -> only A checked
{ tool '{"command":"cd '"$T"'/wtA && pnpm turbo test"}'; } > "$T/t1"
run_gate "$T/t1" >/dev/null
[ "$(cat "$CHECK_LOG")" = "$T/wtA" ] || fail "cd into A should check only A, got: $(cat "$CHECK_LOG")"

# 2. touching nothing -> skip
{ tool '{"command":"ls"}'; } > "$T/t2"
out=$(run_gate "$T/t2"); [ -z "$out" ] && [ ! -s "$CHECK_LOG" ] || fail "nothing touched should skip"

# 3. other agent's dirty worktrees ignored (Codex + untouched B), even if its files are named
{ tool '{"file_path":"'"$HOME"'/.codex/worktrees/codex1/x"}'; } > "$T/t3"
echo bad > "$HOME/.codex/worktrees/codex1/x"; echo bad > "$T/wtB/x"
out=$(run_gate "$T/t3"); [ -z "$out" ] && [ ! -s "$CHECK_LOG" ] || fail "foreign/untouched worktrees must be ignored"

# 4. file path in B (Edit) -> B checked and its failure blocks
{ tool '{"file_path":"'"$T"'/wtB/x"}'; } > "$T/t4"
out=$(run_gate "$T/t4")
[ "$(cat "$CHECK_LOG")" = "$T/wtB" ] || fail "edit in B should check B"
printf '%s' "$out" | jq -e '.decision=="block"' >/dev/null || fail "B failure should block"

# 4b. missing transcript -> falls back to the starting worktree, not a silent skip
: > "$CHECK_LOG"
printf '{"transcript_path":"%s"}' "$T/nope" | CLAUDE_PROJECT_DIR="$T/wtA" bash "$HOOK_DIR/quality-gate.sh" >/dev/null 2>&1
[ "$(cat "$CHECK_LOG")" = "$T/wtA" ] || fail "missing transcript should check the starting worktree"

# 5. stop_hook_active -> allow immediately
: > "$CHECK_LOG"
out=$(printf '{"stop_hook_active":true,"transcript_path":"%s"}' "$T/t4" | bash "$HOOK_DIR/quality-gate.sh" 2>/dev/null)
[ -z "$out" ] && [ ! -s "$CHECK_LOG" ] || fail "stop_hook_active should exit quietly"

# 6. real checker: clean worktree skipped; dirty dep-less worktree BLOCKS (own worktree),
#    unless QUALITY_GATE_SKIP_DEPS=1
git -C "$R" worktree add -q "$T/wtC" -b cc
out=$(bash "$HOOK_DIR/quality-gate-check-worktree.sh" "$T/wtC" 2>/dev/null) || fail "clean worktree must not block"
echo dirty > "$T/wtC/y"
if out=$(bash "$HOOK_DIR/quality-gate-check-worktree.sh" "$T/wtC" 2>/dev/null); then fail "dep-less own worktree must block"; fi
case "$out" in *node_modules*) ;; *) fail "block reason should mention node_modules" ;; esac
QUALITY_GATE_SKIP_DEPS=1 bash "$HOOK_DIR/quality-gate-check-worktree.sh" "$T/wtC" 2>/dev/null || fail "SKIP_DEPS=1 must skip"

# 7. main (unlinked) checkout is checked when the session edited there via relative paths
echo dirty > "$R/x"
{ tool '{"file_path":"x"}' Edit "$R"; } > "$T/t7"
run_gate "$T/t7" >/dev/null
[ "$(cat "$CHECK_LOG")" = "$R" ] || fail "main checkout work should be checked, got: $(cat "$CHECK_LOG")"
# ...and absolute cd into the main checkout counts too
{ tool '{"command":"cd '"$R"' && ls"}' Bash "$T/wtA"; } > "$T/t7b"
run_gate "$T/t7b" >/dev/null
grep -qx "$R" "$CHECK_LOG" || fail "cd into main checkout should check it"

# 8. relative cd resolves against the entry's cwd
{ tool '{"command":"cd ../wtB && ls"}' Bash "$T/wtA"; } > "$T/t8"
run_gate "$T/t8" >/dev/null
grep -qx "$T/wtB" "$CHECK_LOG" || fail "relative cd should resolve to wtB, got: $(cat "$CHECK_LOG")"
{ tool '{"command":"git -C ../wtB status"}' Bash "$T/wtA"; } > "$T/t8b"
run_gate "$T/t8b" >/dev/null
grep -qx "$T/wtB" "$CHECK_LOG" || fail "relative git -C should resolve to wtB"

# 9. no origin/main (merge-base fails): checks are NOT skipped; with deps absent they block
git -C "$R" update-ref -d refs/remotes/origin/main
rm -f "$T/wtC/y"

if out=$(bash "$HOOK_DIR/quality-gate-check-worktree.sh" "$T/wtC" 2>/dev/null); then
  fail "missing merge-base must fall back to full checks (clean tree, expected deps block)"
fi

# 10. `git -C "path with spaces" add` counts as a mutation (main-checkout fallback)
echo dirty > "$R/x"
{ tool '{"command":"git -C \"'"$R"' \" add ."}' Bash "$R"; } > "$T/t10"
jq -r -f "$HOOK_DIR/quality-gate-session-paths.jq" "$T/t10" | grep -q '^M' || fail "quoted -C path with add should be a mutation"
# 11. `git -C` inside another word is not a directory target
{ tool '{"command":"echo digit -C /tmp/nope"}' Bash "$R"; } > "$T/t11"
if jq -r -f "$HOOK_DIR/quality-gate-session-paths.jq" "$T/t11" | grep -q '/tmp/nope'; then fail "git -C inside a word must not match"; fi

# 12. Read-only access does not count as touching a worktree
{ tool '{"file_path":"'"$T"'/wtB/x"}' Read "$T/wtA"; } > "$T/t12"
run_gate "$T/t12" >/dev/null
grep -qx "$T/wtB" "$CHECK_LOG" && fail "Read of wtB must not gate wtB"
grep -qx "$T/wtA" "$CHECK_LOG" || fail "session cwd in linked wtA still counts"

# 13. Bash redirect write into another worktree counts
{ tool '{"command":"echo hi > '"$T"'/wtB/x"}' Bash "$R"; } > "$T/t13"
run_gate "$T/t13" >/dev/null
grep -qx "$T/wtB" "$CHECK_LOG" || fail "redirect into wtB should check wtB"

# 14. chained cd resolves in command order: cd <T> && cd wtB && write
{ tool '{"command":"cd '"$T"' && cd wtB && printf a > f.ts"}' Bash "$R"; } > "$T/t14"
run_gate "$T/t14" >/dev/null
grep -qx "$T/wtB" "$CHECK_LOG" || fail "chained cd should land in wtB, got: $(cat "$CHECK_LOG")"

# 15. `echo cd /path` is a mention, not a directory change
{ tool '{"command":"echo cd '"$T"'/wtB"}' Bash "$R"; } > "$T/t15"
run_gate "$T/t15" >/dev/null
[ ! -s "$CHECK_LOG" ] || fail "echo cd must not count, got: $(cat "$CHECK_LOG")"

# 16. empty / corrupt transcript fails closed to the starting worktree
: > "$T/t16"
: > "$CHECK_LOG"
printf '{"transcript_path":"%s"}' "$T/t16" | CLAUDE_PROJECT_DIR="$T/wtA" bash "$HOOK_DIR/quality-gate.sh" >/dev/null 2>&1
[ "$(cat "$CHECK_LOG")" = "$T/wtA" ] || fail "empty transcript should fall back to starting worktree"
# ...but never to a foreign agent's worktree
: > "$CHECK_LOG"
printf '{"transcript_path":"%s"}' "$T/t16" | CLAUDE_PROJECT_DIR="$HOME/.codex/worktrees/codex1" bash "$HOOK_DIR/quality-gate.sh" >/dev/null 2>&1
[ ! -s "$CHECK_LOG" ] || fail "foreign starting worktree must be ignored"

# 17. extra foreign prefixes via QUALITY_GATE_FOREIGN_PREFIXES
{ tool '{"file_path":"'"$T"'/wtB/x"}'; } > "$T/t17"
: > "$CHECK_LOG"
printf '{"transcript_path":"%s","cwd":"%s"}' "$T/t17" "$R" | QUALITY_GATE_FOREIGN_PREFIXES="$T/wtB" bash "$HOOK_DIR/quality-gate.sh" >/dev/null 2>&1
[ ! -s "$CHECK_LOG" ] || fail "custom foreign prefix should be ignored"

# 18. repeated cwd across calls: a later call from the main checkout is not
#     attributed to the worktree an earlier call cd'd into
{ tool '{"command":"cd '"$T"'/wtA && ls"}' Bash "$R"; tool '{"command":"printf broken > x.ts"}' Bash "$R"; } > "$T/t18"
run_gate "$T/t18" >/dev/null
grep -qx "$R" "$CHECK_LOG" || fail "second call's write in the main checkout must be checked, got: $(cat "$CHECK_LOG")"

# 19. a write BEFORE a later cd in the same command belongs to the original dir
{ tool '{"command":"printf broken > x.ts; cd '"$T"'/wtA"}' Bash "$R"; } > "$T/t19"
run_gate "$T/t19" >/dev/null
grep -qx "$R" "$CHECK_LOG" || fail "write before cd must be attributed to the main checkout, got: $(cat "$CHECK_LOG")"

# 20. sed -i / perl -pi: the file operand is attributed to its worktree
{ tool '{"command":"sed -i s/a/b/ ../wtB/x"}' Bash "$T/wtA"; } > "$T/t20"
run_gate "$T/t20" >/dev/null
grep -qx "$T/wtB" "$CHECK_LOG" || fail "sed -i target in wtB should check wtB, got: $(cat "$CHECK_LOG")"

# 21. fail-closed fallback honours QUALITY_GATE_FOREIGN_PREFIXES
: > "$CHECK_LOG"
printf '{"transcript_path":"%s"}' "$T/t16" | QUALITY_GATE_FOREIGN_PREFIXES="$T/wtA" CLAUDE_PROJECT_DIR="$T/wtA" bash "$HOOK_DIR/quality-gate.sh" >/dev/null 2>&1
[ ! -s "$CHECK_LOG" ] || fail "custom foreign prefix must also be skipped in the fallback"

echo "quality-gate tests: all passed"
