#!/usr/bin/env bash
set -o pipefail -u

INPUT=$(cat)

json_value() {
  printf '%s' "$INPUT" | jq -r "$1 // empty" 2>/dev/null || true
}

block() {
  jq -n --arg reason "$1" '{"decision": "block", "reason": $reason}'
}

trim_output() {
  printf '%s' "$1" | tail -40
}

if printf '%s' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

CWD=$(json_value '.cwd')
LAST_ASSISTANT_MESSAGE=$(json_value '.last_assistant_message')

if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then
  exit 0
fi

cd "$CWD" || exit 0
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  exit 0
fi
cd "$ROOT" || exit 0

QUALITY_GATE_MODE=${CODEX_QUALITY_GATE_MODE:-completion}

looks_like_completion() {
  printf '%s' "$LAST_ASSISTANT_MESSAGE" |
    tr '[:upper:]' '[:lower:]' |
    grep -Eq '(^|[^[:alnum:]_])(done|complete|completed|implemented|fixed|ready|created|added|updated|wired|verified|passing|passes|pr|pull request|commit|pushed|shipped|finished)([^[:alnum:]_]|$)'
}

is_code_change() {
  case "$1" in
    # Bash case patterns match path strings, and '*' can match '/' there. The
    # '**' form documents that nested app/package files are intentionally in
    # scope, without relying on expanded globstar filesystem behavior.
    apps/**/*.ts|apps/**/*.tsx|apps/**/*.js|apps/**/*.jsx|apps/**/*.mjs|apps/**/*.cjs)
      return 0
      ;;
    packages/**/*.ts|packages/**/*.tsx|packages/**/*.js|packages/**/*.jsx|packages/**/*.mjs|packages/**/*.cjs)
      return 0
      ;;
    supabase/migrations/*.sql)
      return 0
      ;;
    package.json|pnpm-lock.yaml|turbo.json|biome.json|tsconfig*.json|pnpm-workspace.yaml)
      return 0
      ;;
    apps/*/package.json|apps/*/tsconfig*.json|apps/*/biome.json)
      return 0
      ;;
    packages/*/package.json|packages/*/tsconfig*.json|packages/*/biome.json)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

requires_colocated_test() {
  local file="$1"
  local name
  name=$(basename "$file")

  case "$name" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.d.ts)
      return 1
      ;;
    *.config.ts|*.config.tsx)
      return 1
      ;;
    page.tsx|layout.tsx|loading.tsx|error.tsx|not-found.tsx|template.tsx|default.tsx|global-error.tsx)
      return 1
      ;;
  esac

  case "$file" in
    */types/*|*/types.ts|*/types.tsx|*/config/*|*/constants/*|*/ui/*|*/templates/*)
      return 1
      ;;
    apps/**/*.ts|apps/**/*.tsx|packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/**/*.ts|packages/*/src/**/*.tsx)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

expected_test_file() {
  local file="$1"
  local dir name ext base

  case "$file" in
    apps/mobile-storefront/app/*)
      local route_path route_dir
      route_path="${file#apps/mobile-storefront/app/}"
      route_dir=$(dirname "$route_path")
      name=$(basename "$route_path")
      ext="${name##*.}"
      base="${name%.*}"

      if [ "$route_dir" = "." ]; then
        printf 'apps/mobile-storefront/__tests__/app/%s.test.%s' "$base" "$ext"
      else
        printf 'apps/mobile-storefront/__tests__/app/%s/%s.test.%s' \
          "$route_dir" "$base" "$ext"
      fi
      return
      ;;
  esac

  dir=$(dirname "$file")
  name=$(basename "$file")
  ext="${name##*.}"
  base="${name%.*}"
  printf '%s/%s.test.%s' "$dir" "$base" "$ext"
}

CHANGED_FILES_FILE=$(mktemp "${TMPDIR:-/tmp}/codex-quality-gate.XXXXXX") || exit 0
trap 'rm -f "$CHANGED_FILES_FILE"' EXIT

{
  git diff --name-only --diff-filter=ACDMRT -z HEAD -- 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
} > "$CHANGED_FILES_FILE"

has_code_changes=0
while IFS= read -r -d '' file; do
  [ -n "$file" ] || continue
  if is_code_change "$file"; then
    has_code_changes=1
    break
  fi
done < "$CHANGED_FILES_FILE"

case "$QUALITY_GATE_MODE" in
  off)
    exit 0
    ;;
  always)
    ;;
  changed)
    [ "$has_code_changes" -eq 1 ] || exit 0
    ;;
  completion|*)
    [ "$has_code_changes" -eq 1 ] || exit 0
    looks_like_completion || exit 0
    ;;
esac

missing_tests=""
while IFS= read -r -d '' file; do
  [ -n "$file" ] || continue
  [ -e "$file" ] || continue
  requires_colocated_test "$file" || continue
  test_file=$(expected_test_file "$file")
  if [ ! -f "$test_file" ]; then
    missing_tests="${missing_tests}
  - ${file} (expected: ${test_file})"
  fi
done < "$CHANGED_FILES_FILE"

if [ -n "$missing_tests" ]; then
  block "Missing colocated tests for new or modified source files:${missing_tests}

Create the expected tests or document why the file is exempt before finishing."
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  block "pnpm is not available, so the Baci quality gate cannot run lint, typecheck, or tests."
  exit 0
fi

TURBO_CMD=(pnpm --config.verify-deps-before-run=false exec turbo)
if [ -x "$ROOT/node_modules/.bin/turbo" ]; then
  TURBO_CMD=("$ROOT/node_modules/.bin/turbo")
fi

run_check() {
  local label="$1"
  shift
  local output status
  output=$("$@" 2>&1)
  status=$?
  if [ "$status" -ne 0 ]; then
    block "${label} failed. Fix this before finishing:\n\n$(trim_output "$output")"
    exit 0
  fi
}

# Scope to packages changed since the origin/main merge base. Empty output
# (QUALITY_GATE_FULL=1, no origin/main, no merge base) keeps the full gate.
HOOK_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
AFFECTED_ARGS=()
for affected_base_script in \
  "$ROOT/ci_scripts/quality-gate-affected-base.sh" \
  "$HOOK_DIR/../../ci_scripts/quality-gate-affected-base.sh"; do
  [ -f "$affected_base_script" ] || continue
  affected_base=$(sh "$affected_base_script" "$ROOT" 2>/dev/null || true)
  if [ -n "$affected_base" ]; then
    export TURBO_SCM_BASE="$affected_base"
    AFFECTED_ARGS=(--affected)
  fi
  break
done

run_check "Biome lint" "${TURBO_CMD[@]}" lint ${AFFECTED_ARGS[@]+"${AFFECTED_ARGS[@]}"}
run_check "TypeScript typecheck" "${TURBO_CMD[@]}" typecheck ${AFFECTED_ARGS[@]+"${AFFECTED_ARGS[@]}"}
run_check "Test suite" "${TURBO_CMD[@]}" test ${AFFECTED_ARGS[@]+"${AFFECTED_ARGS[@]}"}

should_run_coderabbit=0
case "${CODEX_QUALITY_GATE_CODERABBIT:-auto}" in
  0|false|off)
    should_run_coderabbit=0
    ;;
  1|true|on)
    should_run_coderabbit=1
    ;;
  auto|*)
    if looks_like_completion; then
      should_run_coderabbit=1
    fi
    ;;
esac

if [ "$should_run_coderabbit" -eq 1 ] && command -v coderabbit >/dev/null 2>&1; then
  cr_output=$(coderabbit review --prompt-only -t uncommitted 2>&1)
  cr_status=$?
  if [ "$cr_status" -eq 0 ]; then
    if ! printf '%s' "$cr_output" | grep -qiE 'no (actionable )?(findings|issues)|0 findings'; then
      if printf '%s' "$cr_output" | grep -qiE '(^|[[:space:]])(critical|high|medium|low):|findings|suggested next steps|P[0-3]'; then
        block "CodeRabbit found review items. Fix or explicitly address them before finishing:\n\n$(trim_output "$cr_output")"
        exit 0
      fi
    fi
  fi
fi

should_run_pr_review_check=0
case "${CODEX_QUALITY_GATE_PR_REVIEW:-auto}" in
  0|false|off)
    should_run_pr_review_check=0
    ;;
  1|true|on)
    should_run_pr_review_check=1
    ;;
  auto|*)
    if looks_like_completion; then
      should_run_pr_review_check=1
    fi
    ;;
esac

if [ "$should_run_pr_review_check" -eq 1 ] && command -v gh >/dev/null 2>&1; then
  current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  if [ -n "$current_branch" ]; then
    pr_json=$(gh pr view "$current_branch" --json number,url,state,headRefOid,reviews 2>/dev/null || true)
    if [ -n "$pr_json" ] && printf '%s' "$pr_json" | jq -e '.state == "OPEN"' >/dev/null 2>&1; then
      pr_review_findings=$(
        printf '%s' "$pr_json" | jq -r '
          . as $pr
          | (.reviews // [])
          | map(
              select((.state // "") != "DISMISSED")
              | select((.author.login // "") | test("^(github-actions|coderabbitai|chatgpt-codex-connector|claude|claude-code-review|jules)(\\[bot\\])?$"; "i"))
              | select((.commit.oid // "") == ($pr.headRefOid // ""))
              | . as $review
              | (($review.body // "") | ascii_downcase) as $body
              | select(
                  ($body | test("actionable comments posted:|\\bp[0-3]\\b|\\*\\*(critical|high|medium|low)\\*\\*|\\n-\\s*(critical|high|medium|low)\\b"))
                  and ($body | test("no meaningful issues|found no meaningful issues|no actionable findings|no actionable issues|0 findings|no review content was produced|did not return a review") | not)
                )
              | "  - @" + (.author.login // "unknown") + " at " + (.submittedAt // "unknown-time") + " (" + (.state // "COMMENTED") + ")"
            )
          | .[]'
      )

      if [ -n "$pr_review_findings" ]; then
        pr_url=$(printf '%s' "$pr_json" | jq -r '.url // empty')
        pr_number=$(printf '%s' "$pr_json" | jq -r '.number // empty')
        block "PR #${pr_number} has unresolved bot review findings on the current head commit:\n\n${pr_review_findings}\n\nAddress or explicitly dismiss these findings before merging.\n${pr_url}"
        exit 0
      fi
    fi
  fi
fi

exit 0
