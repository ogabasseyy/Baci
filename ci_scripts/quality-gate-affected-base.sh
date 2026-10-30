#!/bin/sh
# Prints the HEAD/origin/main merge base so local quality gates can run turbo --affected; empty output means run the full gate.
set -eu

if [ "${QUALITY_GATE_FULL:-}" = "1" ]; then
  exit 0
fi

dir="${1:-.}"

base=$(git -C "$dir" merge-base HEAD origin/main 2>/dev/null) || exit 0

case "$base" in
  '' | *[!0-9a-f]*) exit 0 ;;
esac

printf '%s\n' "$base"
