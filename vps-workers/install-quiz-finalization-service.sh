#!/usr/bin/env bash
set -euo pipefail

echo "Refusing to install the legacy Baci quiz-finalization user unit. This worker is managed as a baci-worker system service by the release migration." >&2
exit 1
