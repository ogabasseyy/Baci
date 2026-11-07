#!/usr/bin/env bash
# Render only: installing or running the worker belongs to the release owner.
set -euo pipefail
REMOTE_DIR="${1:?worker directory required}"
cat <<EOF
* * * * * flock -n $REMOTE_DIR/locks/piggyvest-webhook-capture-drain.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=piggyvest-webhook-capture-drain && cd $REMOTE_DIR && timeout --signal=TERM --kill-after=10s 50s $REMOTE_DIR/bin/process-piggyvest-webhook-capture-drain.sh --once' >> $REMOTE_DIR/logs/piggyvest-webhook-capture-drain.log 2>&1
EOF
