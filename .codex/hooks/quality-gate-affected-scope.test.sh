#!/usr/bin/env bash
# Self-test for quality-gate-affected-scope.sh, exercised through quality-gate.sh.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/quality-gate.sh"

# Ambient scoping settings must not leak into the hook under test.
unset QUALITY_GATE_FULL TURBO_SCM_BASE

# The hook falls back to `pnpm exec turbo` when the repo has no local turbo.
PNPM_TURBO='pnpm stub --config.verify-deps-before-run=false exec turbo'

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT

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

STUB_BIN="$REPO/bin"
PNPM_LOG="$REPO/pnpm.log"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/pnpm" <<'SH'
#!/usr/bin/env bash
printf 'pnpm stub %s TURBO_SCM_BASE=%s\n' "$*" "${TURBO_SCM_BASE:-}" >> "${PNPM_STUB_LOG:?}"
exit 0
SH
chmod +x "$STUB_BIN/pnpm"

run_stubbed_gate() {
  : > "$PNPM_LOG"
  jq -n --arg cwd "$REPO" \
    '{cwd: $cwd, hook_event_name: "Stop", last_assistant_message: "Implemented the change.", stop_hook_active: false}' |
    env PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off "$@" bash "$HOOK"
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

# With the checkout's own helper, the gate scopes to the origin/main merge base.
mkdir -p "$REPO/ci_scripts"
cp "$SCRIPT_DIR/../../ci_scripts/quality-gate-affected-base.sh" "$REPO/ci_scripts/"
output=$(run_stubbed_gate)
[ -z "$output" ] || fail "affected-scoped gates should allow stop without output"
for check in lint typecheck test; do
  grep -qx "$PNPM_TURBO $check --affected TURBO_SCM_BASE=$base_sha" "$PNPM_LOG" ||
    fail "$check should run --affected against the origin/main merge base"
done

output=$(run_stubbed_gate QUALITY_GATE_FULL=1)
[ -z "$output" ] || fail "QUALITY_GATE_FULL=1 gates should allow stop without output"
assert_unscoped "QUALITY_GATE_FULL=1"

# The gate uses whatever base the checkout's own helper reports.
printf '#!/bin/sh\nprintf "%%s\\n" cafebabecafebabecafebabecafebabecafebabe\n' > "$REPO/ci_scripts/quality-gate-affected-base.sh"
output=$(run_stubbed_gate)
[ -z "$output" ] || fail "repo-local helper gates should allow stop without output"
grep -qx "$PNPM_TURBO lint --affected TURBO_SCM_BASE=cafebabecafebabecafebabecafebabecafebabe" "$PNPM_LOG" ||
  fail "the checkout's quality-gate-affected-base.sh output should set the base"

printf 'quality-gate affected-scope self-test passed\n'
