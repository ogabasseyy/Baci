#!/bin/bash
# Self-test: quality-gate-check-worktree.sh must take its turbo scope only from
# ci_scripts/resolve-turbo-cmd.sh (which asks quality-gate-affected-base.sh), so
# an empty helper verdict ("run the full gate") is never overridden with the
# hook's own merge base, and --affected is passed at most once.
# Run: bash .claude/hooks/quality-gate-affected-scope.test.sh
set -euo pipefail

HOOK_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HOOK_DIR/../.." && pwd)
HOOK="$HOOK_DIR/quality-gate-check-worktree.sh"

# Ambient scoping settings must not leak into the hook under test.
unset QUALITY_GATE_FULL TURBO_SCM_BASE TURBO_SCM_HEAD QUALITY_GATE_SKIP_DEPS

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

T=$(cd -P "$(mktemp -d)" && pwd)
trap 'rm -rf "$T"' EXIT
REPO="$T/repo"
STUB_BIN="$T/bin"
TURBO_LOG="$T/turbo.log"
mkdir -p "$REPO/ci_scripts" "$REPO/node_modules/.bin" "$STUB_BIN"

# The checkout's own resolver and helper, committed on the origin/main side so
# they are not part of the change set. node_modules is ignored for the same reason.
cp "$REPO_ROOT/ci_scripts/resolve-turbo-cmd.sh" "$REPO_ROOT/ci_scripts/quality-gate-affected-base.sh" "$REPO/ci_scripts/"
printf 'node_modules/\n' > "$REPO/.gitignore"

# Stub turbo records its arguments and the base it was given, and (in a second
# file) the comparison head it was given.
cat > "$REPO/node_modules/.bin/turbo" <<'SH'
#!/bin/bash
printf 'turbo %s TURBO_SCM_BASE=%s\n' "$*" "${TURBO_SCM_BASE-<unset>}" >> "${TURBO_STUB_LOG:?}"
printf 'TURBO_SCM_HEAD=%s\n' "${TURBO_SCM_HEAD-<unset>}" >> "${TURBO_STUB_LOG}.head"
exit 0
SH
chmod +x "$REPO/node_modules/.bin/turbo"
# Stub coderabbit (and the jq that parses its output) so the final fail-open
# review step never reaches a real one and needs nothing installed.
printf '#!/bin/bash\nexit 0\n' > "$STUB_BIN/coderabbit"
cp "$STUB_BIN/coderabbit" "$STUB_BIN/jq"
chmod +x "$STUB_BIN/coderabbit" "$STUB_BIN/jq"

git -C "$REPO" init -q
git -C "$REPO" config user.email "gate-test@example.com"
git -C "$REPO" config user.name "Gate Test"
git -C "$REPO" config commit.gpgsign false
git -C "$REPO" config core.hooksPath /dev/null
git -C "$REPO" add -A
git -C "$REPO" commit -qm "base"
base_sha=$(git -C "$REPO" rev-parse HEAD)

commit_file() { # $1 = path relative to the repo
  mkdir -p "$(dirname "$REPO/$1")"
  printf 'export const changed = 1;\n' > "$REPO/$1"
  git -C "$REPO" add "$1"
  git -C "$REPO" commit -qm "change $1"
}

run_gate() { # extra KEY=VALUE environment assignments as arguments
  : > "$TURBO_LOG"
  : > "$TURBO_LOG.head"
  env PATH="$STUB_BIN:$PATH" TURBO_STUB_LOG="$TURBO_LOG" "$@" bash "$HOOK" "$REPO"
}

assert_checks_ran() {
  local label="$1" check
  for check in test lint typecheck; do
    grep -q "^turbo $check " "$TURBO_LOG" || fail "$label: turbo $check did not run"
  done
}

assert_head_unset() {
  local label="$1"
  [ -s "$TURBO_LOG.head" ] || fail "$label: turbo did not run"
  if grep -qvx 'TURBO_SCM_HEAD=<unset>' "$TURBO_LOG.head"; then
    fail "$label: turbo must not see TURBO_SCM_HEAD, got: $(cat "$TURBO_LOG.head")"
  fi
}

assert_unscoped() {
  local label="$1" check
  assert_checks_ran "$label"
  for check in test lint typecheck; do
    grep -qx "turbo $check TURBO_SCM_BASE=<unset>" "$TURBO_LOG" ||
      fail "$label: turbo $check must run unscoped without TURBO_SCM_BASE, got: $(cat "$TURBO_LOG")"
  done
}

# 1. No origin/main yet: no merge base, so the full gate runs.
commit_file apps/web/src/changed.ts
out=$(run_gate) || fail "no origin/main: gate should pass"
[ -z "$out" ] || fail "no origin/main: expected no block output, got: $out"
assert_unscoped "no origin/main"

# 2. Normal change inside a workspace: one --affected against the merge base.
git -C "$REPO" update-ref refs/remotes/origin/main "$base_sha"
out=$(run_gate) || fail "scoped: gate should pass"
[ -z "$out" ] || fail "scoped: expected no block output, got: $out"
assert_checks_ran "scoped"
for check in test lint typecheck; do
  grep -qx "turbo $check --affected TURBO_SCM_BASE=$base_sha" "$TURBO_LOG" ||
    fail "scoped: turbo $check must get exactly one --affected and the merge base, got: $(cat "$TURBO_LOG")"
done

# 3. QUALITY_GATE_FULL=1 forces the full gate even with a valid merge base.
out=$(run_gate QUALITY_GATE_FULL=1) || fail "QUALITY_GATE_FULL=1: gate should pass"
[ -z "$out" ] || fail "QUALITY_GATE_FULL=1: expected no block output, got: $out"
assert_unscoped "QUALITY_GATE_FULL=1"

# 3b. A stale ambient TURBO_SCM_BASE must not leak into a forced full gate, and
#     must be replaced by the merge base for a scoped one.
out=$(run_gate QUALITY_GATE_FULL=1 TURBO_SCM_BASE=stale-ambient-base) || fail "ambient base, full: gate should pass"
[ -z "$out" ] || fail "ambient base, full: expected no block output, got: $out"
assert_unscoped "QUALITY_GATE_FULL=1 with an ambient TURBO_SCM_BASE"
out=$(run_gate TURBO_SCM_BASE=stale-ambient-base) || fail "ambient base, scoped: gate should pass"
[ -z "$out" ] || fail "ambient base, scoped: expected no block output, got: $out"
for check in test lint typecheck; do
  grep -qx "turbo $check --affected TURBO_SCM_BASE=$base_sha" "$TURBO_LOG" ||
    fail "ambient base, scoped: turbo $check must use the merge base, got: $(cat "$TURBO_LOG")"
done

# 3c. A stale ambient TURBO_SCM_HEAD would end the --affected comparison before
#     the current work, so neither a scoped nor a full run may see it.
out=$(run_gate TURBO_SCM_HEAD=stale-ambient-head) || fail "ambient head, scoped: gate should pass"
[ -z "$out" ] || fail "ambient head, scoped: expected no block output, got: $out"
assert_checks_ran "ambient head, scoped"
assert_head_unset "ambient head, scoped"
out=$(run_gate QUALITY_GATE_FULL=1 TURBO_SCM_HEAD=stale-ambient-head) || fail "ambient head, full: gate should pass"
[ -z "$out" ] || fail "ambient head, full: expected no block output, got: $out"
assert_head_unset "ambient head, full"

# 4. A change outside the workspaces (a migration) keeps the full gate.
commit_file supabase/migrations/20990101000000_example.sql
out=$(run_gate) || fail "migration change: gate should pass"
[ -z "$out" ] || fail "migration change: expected no block output, got: $out"
assert_unscoped "migration change"

printf 'quality-gate affected-scope self-test passed\n'
