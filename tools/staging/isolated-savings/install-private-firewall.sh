#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

if [[ "${1:-}" != '--install' || "$#" != 1 || "$EUID" != 0 ]]; then
  printf 'Run as administrator with exactly --install.\n' >&2
  exit 1
fi

for command in iptables ip systemctl install cmp flock; do
  command -v "$command" >/dev/null
done
[[ -x /usr/sbin/iptables ]]
exec 9>/run/lock/baci-isolated-savings-admin.lock
flock -n 9
iptables -w 5 -S INPUT >/dev/null

temporary="$(mktemp -d /run/baci-staging-firewall.XXXXXX)"
trap 'rm -rf -- "$temporary"' EXIT
helper=/usr/local/libexec/baci-staging-firewall
unit=/etc/systemd/system/baci-staging-firewall.service

cat > "$temporary/helper" <<'HELPER'
#!/bin/sh
set -eu
for bridge in baci-stg-db baci-stg-mail; do
  if ! /usr/sbin/iptables -w 5 -C INPUT -i "$bridge" -m conntrack --ctstate NEW -m comment --comment baci-isolated-savings -j DROP 2>/dev/null; then
    /usr/sbin/iptables -w 5 -I INPUT 1 -i "$bridge" -m conntrack --ctstate NEW -m comment --comment baci-isolated-savings -j DROP
  fi
done
HELPER

cat > "$temporary/unit" <<'UNIT'
[Unit]
Description=Block new staging container connections to the VPS host
After=systemd-modules-load.service

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/baci-staging-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

for pair in "helper:$helper" "unit:$unit"; do
  source_name="${pair%%:*}"
  destination="${pair#*:}"
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ ! -L "$destination" && -f "$destination" ]]
    [[ "$(stat -c %u "$destination")" == 0 ]]
    [[ -z "$(find "$destination" -perm /022 -print)" ]]
    if ! cmp -s "$temporary/$source_name" "$destination"; then
      printf 'Existing admin file differs; refusing to overwrite it.\n' >&2
      exit 1
    fi
  fi
done

if [[ ! -f "$helper" || ! -f "$unit" ]]; then
  for bridge in baci-stg-db baci-stg-mail; do
    if ip link show dev "$bridge" >/dev/null 2>&1; then
      printf 'Staging bridge already exists; ownership review required.\n' >&2
      exit 1
    fi
  done
fi

if [[ ! -e /usr/local/libexec ]]; then
  install -d -o root -g root -m 0755 /usr/local/libexec
else
  [[ -d /usr/local/libexec && ! -L /usr/local/libexec ]]
  [[ "$(stat -c %u /usr/local/libexec)" == 0 ]]
  [[ -z "$(find /usr/local/libexec -maxdepth 0 -perm /022 -print)" ]]
fi
install -o root -g root -m 0755 "$temporary/helper" "$helper"
install -o root -g root -m 0644 "$temporary/unit" "$unit"
systemctl daemon-reload
systemctl enable baci-staging-firewall.service >/dev/null
"$helper"
systemctl start baci-staging-firewall.service
systemctl is-active --quiet baci-staging-firewall.service
printf 'Staging isolation rules installed. No app services started; no Nginx or DNS changes.\n'
