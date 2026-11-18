#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/run-web-script.sh" publish-scheduled-posts src/scripts/publish-scheduled-posts.ts "$@"
