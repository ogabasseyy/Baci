#!/usr/bin/env bash
# Self-test for quality-gate-affected-scope.sh, exercised through quality-gate.sh.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/quality-gate.sh"

# Ambient scoping settings must not leak into the hook under test.
unset QUALITY_GATE_FULL TURBO_SCM_BASE TURBO_SCM_HEAD

# The hook falls back to `pnpm exec turbo` when the repo has no local turbo.
PNPM_TURBO='pnpm stub --config.verify-deps-before-run=false exec turbo'

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

REPO=$(mktemp -d)
trap 'rm -rf "$REPO" "${STUB_DIR:-}"' EXIT

git -C "$REPO" init -q || fail "init temp git repo"
git -C "$REPO" config user.email "codex-test@example.com"
git -C "$REPO" config user.name "Codex Test"
printf 'initial\n' > "$REPO/README.md"
git -C "$REPO" add .
git -C "$REPO" commit -qm "initial"

# An untracked code file with its colocated test makes the gate run its checks.
mkdir -p "$REPO/apps/web/src/lib"
printf 'export const changed = 1;\n' > "$REPO/apps/web/src/lib/changed.ts"
printf 'import { describe, it, expect } from "vitest";\ndescribe("changed", () => { it("works", () => expect(1).toBe(1)); });\n' > "$REPO/apps/web/src/lib/changed.test.ts"

# Stubs live outside the repo so they are not part of its change set.
STUB_DIR=$(mktemp -d)
STUB_BIN="$STUB_DIR/bin"
PNPM_LOG="$STUB_DIR/pnpm.log"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/pnpm" <<'SH'
#!/usr/bin/env bash
printf 'pnpm stub %s TURBO_SCM_BASE=%s\n' "$*" "${TURBO_SCM_BASE:-}" >> "${PNPM_STUB_LOG:?}"
printf 'TURBO_SCM_HEAD=%s\n' "${TURBO_SCM_HEAD-<unset>}" >> "${PNPM_STUB_LOG}.head"
exit 0
SH
chmod +x "$STUB_BIN/pnpm"

run_stubbed_gate() {
  : > "$PNPM_LOG"
  : > "$PNPM_LOG.head"
  jq -n --arg cwd "$REPO" \
    '{cwd: $cwd, hook_event_name: "Stop", last_assistant_message: "Implemented the change.", stop_hook_active: false}' |
    env PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off "$@" bash "$HOOK"
}

assert_head_unset() {
  local label="$1"
  [ -s "$PNPM_LOG.head" ] || fail "$label: turbo did not run"
  if grep -qvx 'TURBO_SCM_HEAD=<unset>' "$PNPM_LOG.head"; then
    fail "$label: turbo must not see TURBO_SCM_HEAD, got: $(cat "$PNPM_LOG.head")"
  fi
}

assert_unscoped() {
  local label="$1"
  local check
  for check in lint typecheck test; do
    grep -qx "$PNPM_TURBO $check TURBO_SCM_BASE=" "$PNPM_LOG" || fail "$label: $check should run unscoped"
  done
  if grep -q -e '--affected' "$PNPM_LOG"; then fail "$label: must not pass --affected"; fi
}

# No origin/main in the temp repo: no merge base, so the full gate runs.
output=$(run_stubbed_gate)
[ -z "$output" ] || fail "gates without origin/main should allow stop without output"
assert_unscoped "no origin/main"

# Put HEAD one commit ahead of origin/main so the merge base differs from HEAD.
work_branch=$(git -C "$REPO" symbolic-ref --quiet --short HEAD)
base_sha=$(git -C "$REPO" rev-parse HEAD)
work_sha=$(git -C "$REPO" commit-tree "$base_sha^{tree}" -p "$base_sha" -m "work")
git -C "$REPO" update-ref "refs/heads/$work_branch" "$work_sha"
git -C "$REPO" update-ref refs/remotes/origin/main "$base_sha"

# A checkout without its own helper keeps the full gate, even though the
# hook's checkout has one.
output=$(run_stubbed_gate)
[ -z "$output" ] || fail "gates without a checkout helper should allow stop without output"
assert_unscoped "checkout without quality-gate-affected-base.sh"

# With the checkout's own helper (committed on main, as in a real checkout),
# the gate scopes to the origin/main merge base.
mkdir -p "$REPO/ci_scripts"
cp "$SCRIPT_DIR/../../ci_scripts/quality-gate-affected-base.sh" "$REPO/ci_scripts/"
git -C "$REPO" add ci_scripts
base_sha=$(git -C "$REPO" commit-tree "$(git -C "$REPO" write-tree)" -p "$work_sha" -m "helper")
work_sha=$(git -C "$REPO" commit-tree "$base_sha^{tree}" -p "$base_sha" -m "work 2")
git -C "$REPO" update-ref "refs/heads/$work_branch" "$work_sha"
git -C "$REPO" update-ref refs/remotes/origin/main "$base_sha"
output=$(run_stubbed_gate)
[ -z "$output" ] || fail "affected-scoped gates should allow stop without output"
for check in lint typecheck test; do
  grep -qx "$PNPM_TURBO $check --affected TURBO_SCM_BASE=$base_sha" "$PNPM_LOG" ||
    fail "$check should run --affected against the origin/main merge base"
done

output=$(run_stubbed_gate QUALITY_GATE_FULL=1)
[ -z "$output" ] || fail "QUALITY_GATE_FULL=1 gates should allow stop without output"
assert_unscoped "QUALITY_GATE_FULL=1"

# A stale ambient TURBO_SCM_BASE must not leak into a forced full gate.
output=$(run_stubbed_gate QUALITY_GATE_FULL=1 TURBO_SCM_BASE=stale-ambient-base)
[ -z "$output" ] || fail "QUALITY_GATE_FULL=1 with an ambient base should allow stop without output"
assert_unscoped "QUALITY_GATE_FULL=1 with an ambient TURBO_SCM_BASE"

# A stale ambient TURBO_SCM_HEAD would end the --affected comparison before the
# current work, so neither a scoped nor a full run may see it.
output=$(run_stubbed_gate TURBO_SCM_HEAD=stale-ambient-head)
[ -z "$output" ] || fail "scoped gate with an ambient head should allow stop without output"
assert_head_unset "scoped run with an ambient TURBO_SCM_HEAD"
output=$(run_stubbed_gate QUALITY_GATE_FULL=1 TURBO_SCM_HEAD=stale-ambient-head)
[ -z "$output" ] || fail "full gate with an ambient head should allow stop without output"
assert_head_unset "full run with an ambient TURBO_SCM_HEAD"

# The gate uses whatever base the checkout's own helper reports.
printf '#!/bin/sh\nprintf "%%s\\n" cafebabecafebabecafebabecafebabecafebabe\n' > "$REPO/ci_scripts/quality-gate-affected-base.sh"
output=$(run_stubbed_gate)
[ -z "$output" ] || fail "repo-local helper gates should allow stop without output"
grep -qx "$PNPM_TURBO lint --affected TURBO_SCM_BASE=cafebabecafebabecafebabecafebabecafebabe" "$PNPM_LOG" ||
  fail "the checkout's quality-gate-affected-base.sh output should set the base"

printf 'quality-gate affected-scope self-test passed\n'
