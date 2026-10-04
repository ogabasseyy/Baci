#!/usr/bin/env bash
# Systemd user services for the VPS workers. Extracted from deploy.sh to
# keep the entrypoint within the repository size limit; behavior is
# unchanged (same globals, same order, still under set -euo pipefail).
# Unit content is identical across deploys (no SHA interpolation) and
# only the drain receiver restarts — converging on the live tree — so
# no live-marker gate is needed here (unlike the crontab install).

install_worker_services() {
  echo "==> Installing Vercel drain receiver user service"
  cat <<EOF | ssh "$VPS" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/baci-vercel-log-drain-receiver.service"
[Unit]
Description=Baci Vercel log drain receiver
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/vercel-log-drain-receiver.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  ssh "$VPS" "systemctl --user daemon-reload && systemctl --user enable --now baci-vercel-log-drain-receiver.service && systemctl --user restart baci-vercel-log-drain-receiver.service"

  echo "==> Installing AI storefront trigger user service"
  cat <<EOF | ssh "$VPS" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/baci-ai-storefront-trigger.service"
[Unit]
Description=Baci AI storefront trigger server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/ai-storefront-trigger-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  ssh "$VPS" "systemctl --user daemon-reload && systemctl --user enable --now baci-ai-storefront-trigger.service"

  echo "==> Installing import job trigger user service"
  cat <<EOF | ssh "$VPS" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/baci-import-job-trigger.service"
[Unit]
Description=Baci import job trigger server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=$NODE_BIN $REMOTE_DIR/jobs/import-job-trigger-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  ssh "$VPS" "systemctl --user daemon-reload && systemctl --user enable --now baci-import-job-trigger.service"
}
