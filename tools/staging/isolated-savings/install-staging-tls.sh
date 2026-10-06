#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

if [[ "$#" != 1 || "${1:-}" != '--install' || "$EUID" != 0 ]]; then
  printf 'Administrator execution with --install required.\n' >&2
  exit 1
fi

exec 9>/run/lock/baci-isolated-savings-admin.lock
flock -n 9
available=/etc/nginx/sites-available/staging-auth.ogabassey.com
enabled=/etc/nginx/sites-enabled/staging-auth.ogabassey.com
certificate=/etc/letsencrypt/live/staging-auth.ogabassey.com/cert.pem
for directory in /etc/nginx/sites-available /etc/nginx/sites-enabled; do
  [[ -d "$directory" && ! -L "$directory" ]]
  [[ "$(stat -c %u "$directory")" == 0 ]]
  [[ -z "$(find "$directory" -maxdepth 0 -perm /022 -print)" ]]
done
[[ ! -e "$available" && ! -L "$available" ]]
[[ ! -e "$enabled" && ! -L "$enabled" ]]
openssl x509 -in "$certificate" -noout -checkend 86400 >/dev/null
openssl x509 -in "$certificate" -noout -checkhost staging-auth.ogabassey.com |
  grep -Fx 'Hostname staging-auth.ogabassey.com does match certificate' >/dev/null
nginx -t >/dev/null 2>&1
systemctl is-active --quiet nginx

created_available=0
created_enabled=0
committed=0
cleanup() {
  if [[ "$committed" != 1 ]]; then
    if [[ "$created_enabled" == 1 ]]; then rm -- "$enabled"; fi
    if [[ "$created_available" == 1 ]]; then rm -- "$available"; fi
  fi
}
trap cleanup EXIT
set -o noclobber
cat > "$available" <<'NGINX'
server {
  listen 443 ssl;
  server_name staging-auth.ogabassey.com;
  ssl_certificate /etc/letsencrypt/live/staging-auth.ogabassey.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/staging-auth.ogabassey.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_tickets off;
  server_tokens off;
  access_log off;
  error_log /dev/null emerg;
  if ($host != staging-auth.ogabassey.com) { return 444; }
  if ($ssl_server_name != staging-auth.ogabassey.com) { return 444; }
  client_max_body_size 64k;
  client_header_timeout 10s;
  client_body_timeout 10s;
  keepalive_timeout 10s;
  send_timeout 10s;
  default_type application/json;
  add_header Cache-Control "no-store" always;
  add_header X-Content-Type-Options "nosniff" always;
  return 503 '{"error":"Staging application access is not enabled","code":"STAGING_NOT_READY"}';
}
NGINX
created_available=1
chmod 0644 "$available"
ln -s "$available" "$enabled"
created_enabled=1
nginx -t >/dev/null 2>&1
systemctl reload nginx
committed=1
printf 'Staging TLS installed. All application requests remain disabled (503).\n'
