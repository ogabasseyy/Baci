#!/usr/bin/env bash
# Installs the PiggyVest daily reconciliation as a systemd USER timer of the
# user that runs it (baci-worker in the isolated layout). Owner-run, see
# docs/piggyvest-daily-reconciliation.md. Deliberately NOT part of
# worker-release.sh: merging code never installs or starts the timer.
# The unit holds no secrets: it loads the persistent env file by path, and the
# runner reads BACI_WEB_BASE_URL and CRON_SECRET from that environment.
# Re-running replaces both units cleanly.
#
# Usage: install-piggyvest-daily-reconciliation-timer.sh [CURRENT_DIR] [ENV_FILE] [NODE_BIN]
#   CURRENT_DIR is the 'current' release symlink, so each release is picked up.
set -euo pipefail

CURRENT_DIR="${1:-/srv/baci-worker/current}"
ENV_FILE="${2:-/srv/baci-worker/baci-workers/.env}"
NODE_BIN="${3:-/usr/bin/node}"
SYSTEMD_DIR="$HOME/.config/systemd/user"
NAME="baci-piggyvest-daily-reconciliation"
SERVICE="$NAME.service"
TIMER="$NAME.timer"
RUNNER="$CURRENT_DIR/workers/jobs/run-web-cron.mjs"

if [ ! -f "$RUNNER" ]; then
  echo "[piggyvest-daily-reconciliation] $RUNNER not found; deploy the workers first" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "[piggyvest-daily-reconciliation] $ENV_FILE not found" >&2
  exit 1
fi

mkdir -p "$SYSTEMD_DIR"
cat > "$SYSTEMD_DIR/$SERVICE" <<UNIT_EOF
[Unit]
Description=Baci PiggyVest daily reconciliation (read-only report)

[Service]
Type=oneshot
WorkingDirectory=$CURRENT_DIR/workers
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $RUNNER /api/cron/piggyvest-daily-reconciliation
TimeoutStartSec=300
NoNewPrivileges=true
# Reads its code and env file, writes nothing to disk (journald only). It must
# call the web app over HTTPS, so no network isolation and no IP allow/deny lists.
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
MemoryMax=256M
TasksMax=256
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UNIT_EOF

cat > "$SYSTEMD_DIR/$TIMER" <<UNIT_EOF
[Unit]
Description=Baci PiggyVest daily reconciliation at 23:00 UTC (midnight Lagos)

[Timer]
OnCalendar=*-*-* 23:00:00 UTC
Persistent=true
AccuracySec=1min
Unit=$SERVICE

[Install]
WantedBy=timers.target
UNIT_EOF

systemctl --user daemon-reload
systemctl --user enable --now "$TIMER"
systemctl --user --no-pager list-timers "$TIMER" || true
