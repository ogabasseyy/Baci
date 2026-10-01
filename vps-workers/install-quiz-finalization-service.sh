#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR="${1:-$HOME/baci-workers}"
SYSTEMD_DIR="$HOME/.config/systemd/user"
CURRENT_USER="$(id -un)"

mkdir -p "$SYSTEMD_DIR" "$REMOTE_DIR/locks" "$REMOTE_DIR/logs"

cat > "$SYSTEMD_DIR/baci-quiz-finalization.service" <<EOF
[Unit]
Description=Baci quiz deadline finalizer
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
Environment=NODE_ENV=production
Environment=BACI_WORKER_PROFILE=quiz-finalization
ExecStart=/usr/bin/flock -n $REMOTE_DIR/locks/quiz-finalize.lock $REMOTE_DIR/bin/process-quiz-finalization.sh --loop
Restart=always
RestartSec=1
KillMode=control-group
TimeoutStopSec=2
StandardOutput=append:$REMOTE_DIR/logs/quiz-finalize.log
StandardError=append:$REMOTE_DIR/logs/quiz-finalize.log

[Install]
WantedBy=default.target
EOF

if [ "$(loginctl show-user "$CURRENT_USER" -p Linger --value)" != "yes" ]; then
  loginctl enable-linger "$CURRENT_USER"
fi
if [ "$(loginctl show-user "$CURRENT_USER" -p Linger --value)" != "yes" ]; then
  echo "[quiz-finalization] unable to enable user linger" >&2
  exit 1
fi

systemctl --user daemon-reload
systemctl --user enable baci-quiz-finalization.service
systemctl --user restart baci-quiz-finalization.service
