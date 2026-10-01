#!/bin/sh
set -eu

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 1

case "$(git config --bool core.sparseCheckout 2>/dev/null || printf false)" in
  true) exit 0 ;;
  *) exit 1 ;;
esac
