#!/usr/bin/env bash
set -euo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/quality-gate.sh"
PNPM_TURBO='pnpm stub --config.verify-deps-before-run=false exec turbo' # no local turbo: pnpm exec fallback

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

make_input() {
  local cwd="$1"
  local message="$2"
  local active="$3"
  jq -n \
    --arg cwd "$cwd" \
    --arg message "$message" \
    --argjson active "$active" \
    '{
      cwd: $cwd,
      hook_event_name: "Stop",
      last_assistant_message: $message,
      model: "gpt-test",
      permission_mode: "dontAsk",
      session_id: "test-session",
      stop_hook_active: $active,
      transcript_path: null,
      turn_id: "test-turn"
    }'
}

run_hook() {
  local cwd="$1"
  local message="$2"
  local active="${3:-false}"
  local mode="${4:-completion}"
  make_input "$cwd" "$message" "$active" |
    CODEX_QUALITY_GATE_MODE="$mode" CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
}

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

git -C "$TMPDIR" init -q || fail "init temp git repo"
git -C "$TMPDIR" config user.email "codex-test@example.com"
git -C "$TMPDIR" config user.name "Codex Test"

mkdir -p "$TMPDIR/apps/web/src/lib"
printf 'export const existing = 1;\n' > "$TMPDIR/apps/web/src/lib/existing.ts"
printf 'import { describe, it, expect } from "vitest";\ndescribe("existing", () => { it("works", () => expect(1).toBe(1)); });\n' > "$TMPDIR/apps/web/src/lib/existing.test.ts"
printf 'export const legacy = 1;\n' > "$TMPDIR/apps/web/src/lib/legacy-without-test.ts"
mkdir -p "$TMPDIR/packages/shared/src"
printf 'export const shared = 1;\n' > "$TMPDIR/packages/shared/src/index.ts"
printf 'import { describe, it, expect } from "vitest";\ndescribe("shared", () => { it("works", () => expect(1).toBe(1)); });\n' > "$TMPDIR/packages/shared/src/index.test.ts"
git -C "$TMPDIR" add .
git -C "$TMPDIR" commit -qm "initial"

output=$(run_hook "$TMPDIR" "Implemented the change." true)
[ -z "$output" ] || fail "stop_hook_active should allow stop without output"

output=$(run_hook "$TMPDIR" "Implemented the change." false)
[ -z "$output" ] || fail "clean repo should allow stop without output"

STUB_BIN="$TMPDIR/bin"
PNPM_LOG="$TMPDIR/pnpm.log"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/pnpm" <<'SH'
#!/usr/bin/env bash
printf 'pnpm stub %s\n' "$*" >> "${PNPM_STUB_LOG:?}"
exit 0
SH
chmod +x "$STUB_BIN/pnpm"

cat > "$STUB_BIN/gh" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then
  for arg in "$@"; do
    if [ "$arg" = "--head" ]; then
      exit 2
    fi
  done
  if [ -n "${GH_STUB_EXPECT_BRANCH:-}" ] && [ "${3:-}" != "$GH_STUB_EXPECT_BRANCH" ]; then
    exit 3
  fi
  printf '%s\n' "${GH_STUB_PR_JSON:-}"
  exit 0
fi
exit 1
SH
chmod +x "$STUB_BIN/gh"

rm "$TMPDIR/apps/web/src/lib/existing.ts"
: > "$PNPM_LOG"
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "deleted code file with existing test should allow stop without output"
grep -q "$PNPM_TURBO lint" "$PNPM_LOG" || fail "deleted code file should run lint"
grep -q "$PNPM_TURBO typecheck" "$PNPM_LOG" || fail "deleted code file should run typecheck"
grep -q "$PNPM_TURBO test" "$PNPM_LOG" || fail "deleted code file should run tests"
git -C "$TMPDIR" checkout -- apps/web/src/lib/existing.ts

rm "$TMPDIR/apps/web/src/lib/legacy-without-test.ts"
: > "$PNPM_LOG"
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "deleted legacy code file without existing test should allow stop without output"
grep -q "$PNPM_TURBO lint" "$PNPM_LOG" || fail "deleted legacy code file should run lint"
grep -q "$PNPM_TURBO typecheck" "$PNPM_LOG" || fail "deleted legacy code file should run typecheck"
grep -q "$PNPM_TURBO test" "$PNPM_LOG" || fail "deleted legacy code file should run tests"
git -C "$TMPDIR" checkout -- apps/web/src/lib/legacy-without-test.ts

mkdir -p "$TMPDIR/apps/mobile-admin/services" "$TMPDIR/apps/mobile-storefront/constants"
printf 'export const mobileAdminService = 1;\n' > "$TMPDIR/apps/mobile-admin/services/mobile-admin-service.ts"
output=$(run_hook "$TMPDIR" "Implemented the change." false)
printf '%s' "$output" | jq -e '.decision == "block"' >/dev/null || fail "app code outside allowlisted folders without tests should block"
printf '%s' "$output" | grep -q 'mobile-admin-service.test.ts' || fail "app code outside allowlisted folders should name expected test file"

printf 'import { describe, it, expect } from "vitest";\ndescribe("mobileAdminService", () => { it("works", () => expect(1).toBe(1)); });\n' > "$TMPDIR/apps/mobile-admin/services/mobile-admin-service.test.ts"
# Constants/config folders are exempt from colocated-test enforcement but still
# count as code changes, so the normal lint/typecheck/test gates should run.
printf 'export const mobileStorefrontConstant = 1;\n' > "$TMPDIR/apps/mobile-storefront/constants/mobile-storefront-constant.ts"
: > "$PNPM_LOG"
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "tested app code outside allowlisted folders should allow stop without output"
grep -q "$PNPM_TURBO lint" "$PNPM_LOG" || fail "app code outside allowlisted folders should run lint"
grep -q "$PNPM_TURBO typecheck" "$PNPM_LOG" || fail "app code outside allowlisted folders should run typecheck"
grep -q "$PNPM_TURBO test" "$PNPM_LOG" || fail "app code outside allowlisted folders should run tests"
rm "$TMPDIR/apps/mobile-admin/services/mobile-admin-service.ts"
rm "$TMPDIR/apps/mobile-admin/services/mobile-admin-service.test.ts"
rm "$TMPDIR/apps/mobile-storefront/constants/mobile-storefront-constant.ts"

printf 'export const mobileStorefrontConstant = 1;\n' > "$TMPDIR/apps/mobile-storefront/constants/mobile-storefront-constant.ts"
: > "$PNPM_LOG"
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "constants-only app code should allow stop without output"
grep -q "$PNPM_TURBO lint" "$PNPM_LOG" || fail "constants-only app code should run lint"
grep -q "$PNPM_TURBO typecheck" "$PNPM_LOG" || fail "constants-only app code should run typecheck"
grep -q "$PNPM_TURBO test" "$PNPM_LOG" || fail "constants-only app code should run tests"
rm "$TMPDIR/apps/mobile-storefront/constants/mobile-storefront-constant.ts"

printf 'export const shared = 2;\n' > "$TMPDIR/packages/shared/src/index.ts"
: > "$PNPM_LOG"
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "top-level package src code should allow stop without output when tested"
grep -q "$PNPM_TURBO lint" "$PNPM_LOG" || fail "top-level package src code should run lint"
grep -q "$PNPM_TURBO typecheck" "$PNPM_LOG" || fail "top-level package src code should run typecheck"
grep -q "$PNPM_TURBO test" "$PNPM_LOG" || fail "top-level package src code should run tests"
git -C "$TMPDIR" checkout -- packages/shared/src/index.ts

printf '{"scripts":{"test":"vitest"}}\n' > "$TMPDIR/apps/web/package.json"
printf '{"extends":"../../tsconfig.json"}\n' > "$TMPDIR/apps/web/tsconfig.json"
: > "$PNPM_LOG"
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "workspace manifest and tsconfig changes should allow stop without output"
grep -q "$PNPM_TURBO lint" "$PNPM_LOG" || fail "workspace manifest and tsconfig changes should run lint"
grep -q "$PNPM_TURBO typecheck" "$PNPM_LOG" || fail "workspace manifest and tsconfig changes should run typecheck"
grep -q "$PNPM_TURBO test" "$PNPM_LOG" || fail "workspace manifest and tsconfig changes should run tests"
rm "$TMPDIR/apps/web/package.json" "$TMPDIR/apps/web/tsconfig.json"

printf 'export const missing = 1;\n' > "$TMPDIR/apps/web/src/lib/missing-test.ts"
output=$(run_hook "$TMPDIR" "Implemented the change." false)
printf '%s' "$output" | jq -e '.decision == "block"' >/dev/null || fail "missing test should block"
printf '%s' "$output" | grep -q 'missing-test.test.ts' || fail "missing test output should name expected test file"

printf 'import { describe, it, expect } from "vitest";\ndescribe("missing", () => { it("works", () => expect(1).toBe(1)); });\n' > "$TMPDIR/apps/web/src/lib/missing-test.test.ts"
: > "$PNPM_LOG"

output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=off bash "$HOOK"
)
[ -z "$output" ] || fail "passing stubbed gates should allow stop without output"

head_sha=$(git -C "$TMPDIR" rev-parse HEAD)
current_branch=$(git -C "$TMPDIR" symbolic-ref --quiet --short HEAD)
pr_findings_json=$(jq -n --arg head "$head_sha" '{
  number: 999,
  url: "https://example.com/pr/999",
  state: "OPEN",
  headRefOid: $head,
  reviews: [
    {
      author: { login: "github-actions" },
      state: "COMMENTED",
      submittedAt: "2026-05-18T00:00:00Z",
      commit: { oid: $head },
      body: "## Findings\n- Low: sample finding\n## Suggested next steps\n- Fix it"
    }
  ]
}')
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" GH_STUB_PR_JSON="$pr_findings_json" GH_STUB_EXPECT_BRANCH="$current_branch" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=on bash "$HOOK"
)
printf '%s' "$output" | jq -e '.decision == "block"' >/dev/null || fail "head-commit bot findings should block"
printf '%s' "$output" | grep -q 'PR #999 has unresolved bot review findings' || fail "PR findings block should include PR context"

pr_findings_bot_suffix_json=$(jq -n --arg head "$head_sha" '{
  number: 1002,
  url: "https://example.com/pr/1002",
  state: "OPEN",
  headRefOid: $head,
  reviews: [
    {
      author: { login: "github-actions[bot]" },
      state: "COMMENTED",
      submittedAt: "2026-05-18T00:00:00Z",
      commit: { oid: $head },
      body: "## Findings\n- Low: sample finding\n## Suggested next steps\n- Fix it"
    }
  ]
}')
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" GH_STUB_PR_JSON="$pr_findings_bot_suffix_json" GH_STUB_EXPECT_BRANCH="$current_branch" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=on bash "$HOOK"
)
printf '%s' "$output" | jq -e '.decision == "block"' >/dev/null || fail "bot findings with [bot] suffix should block"

pr_stale_findings_json=$(jq -n --arg head "$head_sha" '{
  number: 1000,
  url: "https://example.com/pr/1000",
  state: "OPEN",
  headRefOid: $head,
  reviews: [
    {
      author: { login: "github-actions" },
      state: "COMMENTED",
      submittedAt: "2026-05-18T00:00:00Z",
      commit: { oid: "deadbeef" },
      body: "## Findings\n- Low: stale finding\n## Suggested next steps\n- Ignore"
    }
  ]
}')
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" GH_STUB_PR_JSON="$pr_stale_findings_json" GH_STUB_EXPECT_BRANCH="$current_branch" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=on bash "$HOOK"
)
[ -z "$output" ] || fail "non-head commit findings should not block"

pr_no_issues_json=$(jq -n --arg head "$head_sha" '{
  number: 1001,
  url: "https://example.com/pr/1001",
  state: "OPEN",
  headRefOid: $head,
  reviews: [
    {
      author: { login: "github-actions" },
      state: "COMMENTED",
      submittedAt: "2026-05-18T00:00:00Z",
      commit: { oid: $head },
      body: "## Findings\nI found no meaningful issues.\n- No meaningful issues found.\n## Suggested next steps\n- Merge."
    }
  ]
}')
output=$(
  make_input "$TMPDIR" "Implemented the change." false |
    PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" GH_STUB_PR_JSON="$pr_no_issues_json" GH_STUB_EXPECT_BRANCH="$current_branch" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=on bash "$HOOK"
)
[ -z "$output" ] || fail "head review with explicit no-issues verdict should not block"

pr_no_review_content_only_json=$(jq -n --arg head "$head_sha" '{
  number: 1003,
  url: "https://example.com/pr/1003",
  state: "OPEN",
  headRefOid: $head,
  reviews: [
    {
      author: { login: "github-actions[bot]" },
      state: "COMMENTED",
      submittedAt: "2026-05-18T00:00:00Z",
      commit: { oid: $head },
      body: "## Findings\n\n- low: No review content was produced."
    }
  ]
}')

pr_did_not_return_review_json=$(jq -n --arg head "$head_sha" '{
  number: 1004,
  url: "https://example.com/pr/1004",
  state: "OPEN",
  headRefOid: $head,
  reviews: [
    {
      author: { login: "github-actions[bot]" },
      state: "COMMENTED",
      submittedAt: "2026-05-18T00:00:00Z",
      commit: { oid: $head },
      body: "## Verdict\n\nGemini did not return a review (step outcome: `failure`)."
    }
  ]
}')

for pr_json in "$pr_no_review_content_only_json" "$pr_did_not_return_review_json"; do
  output=$(
    make_input "$TMPDIR" "Implemented the change." false |
      PATH="$STUB_BIN:$PATH" PNPM_STUB_LOG="$PNPM_LOG" GH_STUB_PR_JSON="$pr_json" GH_STUB_EXPECT_BRANCH="$current_branch" CODEX_QUALITY_GATE_MODE=completion CODEX_QUALITY_GATE_CODERABBIT=0 CODEX_QUALITY_GATE_PR_REVIEW=on bash "$HOOK"
  )
  [ -z "$output" ] || fail "head review with no generated review content should not block"
done

printf 'quality-gate self-test passed\n'
