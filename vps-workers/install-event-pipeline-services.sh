#!/usr/bin/env bash
set -euo pipefail

echo "Refusing to install legacy Baci event-pipeline user units. These workers are managed as baci-worker system services by the release migration." >&2
exit 1
