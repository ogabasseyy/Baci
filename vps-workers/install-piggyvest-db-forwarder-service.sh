#!/usr/bin/env bash
# Installs the PiggyVest DB forwarder as a systemd USER service of the user
# that runs it (baci-worker in the isolated layout). Owner-run, see
# docs/runbooks/piggyvest-db-forwarder.md. Deliberately NOT part of
# worker-release.sh: merging code never installs or starts the forwarder.
# The forwarder has no env file and no secrets: upstream and port are fixed in code.
#
# Usage: install-piggyvest-db-forwarder-service.sh [WORKERS_DIR] [NODE_BIN]
set -euo pipefail

REMOTE_DIR="${1:-$HOME/baci-workers}"
NODE_BIN="${2:-/usr/bin/node}"
SYSTEMD_DIR="$HOME/.config/systemd/user"
UNIT="baci-piggyvest-db-forwarder.service"

if [ ! -f "$REMOTE_DIR/jobs/piggyvest-db-forwarder.mjs" ]; then
  echo "[piggyvest-db-forwarder] $REMOTE_DIR/jobs/piggyvest-db-forwarder.mjs not found; deploy the workers first" >&2
  exit 1
fi

mkdir -p "$SYSTEMD_DIR"
cat > "$SYSTEMD_DIR/$UNIT" <<UNIT_EOF
[Unit]
Description=Baci PiggyVest DB forwarder (TCP passthrough to Supabase direct host)

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/piggyvest-db-forwarder.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
# Reads only its code under REMOTE_DIR and writes nothing to disk (journald
# only). Port 15432 is unprivileged, so it binds without extra capabilities.
# It needs a public listener and outbound IPv6, so no network isolation and no
# IP allow/deny lists here; AF_INET6 is required for the upstream hop.
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
MemoryMax=256M
TasksMax=256
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=default.target
UNIT_EOF

systemctl --user daemon-reload
systemctl --user enable "$UNIT"
systemctl --user restart "$UNIT"
systemctl --user --no-pager --lines=5 status "$UNIT" || true
