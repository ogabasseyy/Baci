#!/bin/bash
# Tests for quality-gate.sh session scoping. Run: bash .claude/hooks/quality-gate.test.sh
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
T=$(cd -P "$(mktemp -d)" && pwd); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.codex/worktrees"
fail() { echo "FAIL: $*" >&2; exit 1; }

R="$T/repo"; git init -q "$R"; git -C "$R" -c user.email=a@b -c user.name=t commit -q --allow-empty -m init
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
tool() { jq -nc --argjson i "$1" '{type:"assistant",cwd:"'"$R"'",message:{content:[{type:"tool_use",name:"X",input:$i}]}}'; }

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

# 5. stop_hook_active -> allow immediately
: > "$CHECK_LOG"
out=$(printf '{"stop_hook_active":true,"transcript_path":"%s"}' "$T/t4" | bash "$HOOK_DIR/quality-gate.sh" 2>/dev/null)
[ -z "$out" ] && [ ! -s "$CHECK_LOG" ] || fail "stop_hook_active should exit quietly"

# 6. real checker skips a clean worktree and a dep-less dirty one without blocking
git -C "$R" worktree add -q "$T/wtC" -b cc
out=$(bash "$HOOK_DIR/quality-gate-check-worktree.sh" "$T/wtC" 2>/dev/null) || fail "clean worktree must not block"
echo dirty > "$T/wtC/y"
out=$(bash "$HOOK_DIR/quality-gate-check-worktree.sh" "$T/wtC" 2>/dev/null) || fail "dep-less worktree must be skipped"

echo "quality-gate tests: all passed"
