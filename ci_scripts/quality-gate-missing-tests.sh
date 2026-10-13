#!/bin/sh
# Emit missing colocated test paths for staged/untracked source files.
# Prints one "  - path (expected: test)" line per gap; empty stdout means none.
set -eu

MISSING_TESTS=""
# shellcheck disable=SC2046
for FILE in $(git diff --name-only --cached --diff-filter=ACM 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null); do
  FILE=$(echo "$FILE" | tr -d '\r' | xargs)
  [ -z "$FILE" ] && continue
  case "$FILE" in
    apps/*/src/**/*.ts|apps/*/src/**/*.tsx|packages/*/src/**/*.ts|packages/*/src/**/*.tsx) ;;
    *) continue ;;
  esac
  BASENAME=$(basename "$FILE")
  case "$BASENAME" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) continue ;;
    *.d.ts) continue ;;
    index.ts|index.tsx) continue ;;
    page.tsx|layout.tsx|loading.tsx|error.tsx) continue ;;
    not-found.tsx|template.tsx|default.tsx) continue ;;
    global-error.tsx|route.ts) continue ;;
    globals.css|*.css) continue ;;
  esac
  case "$FILE" in
    */types/*|*/types.ts|*/types.tsx) continue ;;
    */config/*|*/constants/*) continue ;;
    */ui/*) continue ;;
    */contexts/*) continue ;;
    */templates/*) continue ;;
  esac
  DIR=$(dirname "$FILE")
  EXT="${BASENAME##*.}"
  BASE="${BASENAME%.*}"
  TEST_FILE="$DIR/$BASE.test.$EXT"
  if [ ! -f "$TEST_FILE" ]; then
    MISSING_TESTS="$MISSING_TESTS\n  - $FILE (expected: $TEST_FILE)"
  fi
done

if [ -n "$MISSING_TESTS" ]; then
  printf '%b' "$MISSING_TESTS"
fi
