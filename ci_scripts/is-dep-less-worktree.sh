#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)

if sh "$script_dir/is-sparse-checkout.sh"; then
  exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
if [ -L "$root/node_modules" ]; then
  exit 0
fi

exit 1
