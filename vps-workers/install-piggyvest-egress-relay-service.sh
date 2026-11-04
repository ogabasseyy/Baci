#!/usr/bin/env bash
# Installs the PiggyVest egress relay as a systemd USER service of the user
# that runs it (baci-worker in the isolated layout). Owner-run, see
# docs/runbooks/piggyvest-egress-relay.md. Deliberately NOT part of
# worker-release.sh: merging code never installs or starts the relay.
#
# Usage: install-piggyvest-egress-relay-service.sh [WORKERS_DIR] [NODE_BIN]
set -euo pipefail

REMOTE_DIR="${1:-$HOME/baci-workers}"
NODE_BIN="${2:-/usr/bin/node}"
SYSTEMD_DIR="$HOME/.config/systemd/user"
ENV_FILE="$REMOTE_DIR/piggyvest-egress-relay.env"
UNIT="baci-piggyvest-egress-relay.service"

if [ ! -f "$ENV_FILE" ]; then
  echo "[piggyvest-egress-relay] create $ENV_FILE (mode 600) first; see the runbook" >&2
  exit 1
fi
# Read (never print) the shared secret: a short or missing one makes the relay
# refuse every request, so fail before installing rather than after.
SECRET_VALUE="$(grep -E '^PIGGYVEST_EGRESS_RELAY_SECRET=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
SECRET_VALUE="${SECRET_VALUE%\"}"
SECRET_VALUE="${SECRET_VALUE#\"}"
if [ "${#SECRET_VALUE}" -lt 32 ]; then
  echo "[piggyvest-egress-relay] PIGGYVEST_EGRESS_RELAY_SECRET in $ENV_FILE must be at least 32 characters" >&2
  exit 1
fi
unset SECRET_VALUE
if [ "$(stat -c '%a' "$ENV_FILE")" != "600" ]; then
  echo "[piggyvest-egress-relay] $ENV_FILE must be mode 600" >&2
  exit 1
fi

mkdir -p "$SYSTEMD_DIR"
cat > "$SYSTEMD_DIR/$UNIT" <<UNIT_EOF
[Unit]
Description=Baci PiggyVest egress relay
After=network-online.target
ConditionPathExists=$ENV_FILE

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/piggyvest-egress-relay.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
# The relay only reads its code and env file (both under REMOTE_DIR) and
# writes nothing to disk (journald only).
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
MemoryMax=256M
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=default.target
UNIT_EOF

systemctl --user daemon-reload
systemctl --user enable "$UNIT"
systemctl --user restart "$UNIT"
systemctl --user --no-pager --lines=5 status "$UNIT" || true
