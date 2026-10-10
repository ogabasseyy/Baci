#!/bin/sh
set -eu
umask 077

bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
code=/opt/baci-savings-gateway
config=/etc/baci-savings-gateway
state=/var/lib/baci-savings-gateway-install
gateway_unit=/etc/systemd/system/baci-savings-gateway.service
draft_unit=/etc/systemd/system/baci-savings-drafts.service
smoke_unit=/etc/systemd/system/baci-savings-drafts-smoke.service
timer_unit=/etc/systemd/system/baci-savings-drafts-deadline.timer
stage=preflight
old_receipt=c8b95a4eb3c8d6306f138e157a32bdf884b76474979cdbc25e0e9bcc988941c5
old_gateway=4458d76a23f530586126c1da5b0e05615deb4b0643e0fdcc0c58f9f42908a00b
old_draft=ea802ae4be62a79f4230c5d78fe60e3964d17173354dbebbd6d64e0acd2aafa9
old_smoke=00ec681a72eb678a61463d7480a1c344ffc19680c302c4a072a20d7932501b97
old_timer=13e74f1efe9f193f9fa33b074812416bfb60e6b34b4e1c4a403baff25795a90f

log() { printf '{"stage":"%s","status":"%s"}\n' "$1" "$2"; }
die() { log "$stage" refused >&2; exit 1; }
hash() { /usr/bin/sha256sum "$1" | /usr/bin/awk '{print $1}'; }
quiet() { "$@" >/dev/null 2>&1; }
test "$(/usr/bin/id -u)" = 0 || die
test "$(hash "$state/receipt.json")" = "$old_receipt" || die
test "$(hash "$gateway_unit")" = "$old_gateway" || die
test "$(hash "$draft_unit")" = "$old_draft" || die
test "$(hash "$smoke_unit")" = "$old_smoke" || die
test "$(hash "$timer_unit")" = "$old_timer" || die
test ! -e "$state/renewal-receipt.json" || die
(cd "$bundle" && /usr/bin/sha256sum -c SHA256SUMS >/dev/null) || die
for unit in baci-savings-gateway.service baci-savings-drafts.service baci-savings-drafts-smoke.service; do
  test "$(/usr/bin/systemctl show "$unit" -p MainPID --value)" = 0 || die
done
for name in managed-private-smoke-runner.mjs managed-hosted-draft-renewal-runner.mjs managed-hosted-draft-identity.json; do
  test ! -e "$code/$name" && test ! -L "$code/$name" || die
done

stage=predecessor-runtime
/usr/bin/python3 - "$bundle/managed-install-manifest.json" "$state/receipt.json" "$code" "$gateway_unit" <<'PY' >/dev/null 2>&1
import hashlib, json, pathlib, sys
manifest_path, receipt_path, code_path, gateway_unit = map(pathlib.Path, sys.argv[1:])
manifest_bytes = manifest_path.read_bytes()
manifest = json.loads(manifest_bytes)
receipt = json.loads(receipt_path.read_bytes())
if manifest.get('version') != 1 or receipt.get('manifestSha256') != hashlib.sha256(manifest_bytes).hexdigest(): raise SystemExit(1)
runtime = ('managed-gateway-cli.mjs', 'managed-gateway.mjs', 'managed-files.mjs', 'managed-inventory-helper.mjs', 'private-routing.mjs', 'private-routing-inventory.mjs', 'private-routing-supervisor-inventory.mjs', 'private-routing-supervisor-child.py', 'compose.mjs')
expected_names = set(runtime) | {'install-managed-gateway.py', 'managed-install-policy.py', 'managed-install-transaction.py', 'managed-gateway.service', 'managed-gateway.sudoers'}
if set(manifest.get('files', {})) != expected_names: raise SystemExit(1)
for name in (*runtime, 'managed-gateway.service', 'managed-gateway.sudoers'):
    expected = manifest['files'][name]
    if name == 'managed-gateway.service': paths = [code_path / 'baci-savings-gateway.service', gateway_unit]
    elif name == 'managed-gateway.sudoers': paths = [code_path / name, pathlib.Path('/etc/sudoers.d/baci-savings-gateway')]
    else: paths = [code_path / name]
    for path in paths:
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected: raise SystemExit(1)
PY

stage=unit-shape
/usr/bin/python3 - "$draft_unit" "$smoke_unit" <<'PY' >/dev/null 2>&1
import pathlib, sys
draft = pathlib.Path(sys.argv[1]).read_text()
smoke = pathlib.Path(sys.argv[2]).read_text()
if smoke != draft.replace('PORT=4792', 'PORT=4794').replace('RuntimeMaxSec=1d', 'RuntimeMaxSec=120'): raise SystemExit(1)
PY
test "$(/usr/bin/find "$config" -maxdepth 1 -type f -printf '%f\n' | /usr/bin/sort | /usr/bin/tr '\n' ' ')" = 'binding.json startup-evidence.json ' || die

archive_id=$(/bin/date -u +%s)
archive="$state/renewals/$archive_id"
backup="$archive/original"
failed="$archive/failed-fresh"
fresh_started=false
quiet /usr/bin/install -d -o root -g root -m 0700 "$backup" || die
for source in "$code/managed-gateway.mjs" "$gateway_unit" "$draft_unit" "$smoke_unit" "$timer_unit"; do
  test -f "$source" && test ! -L "$source" || die
  quiet /usr/bin/cp --preserve=all -- "$source" "$backup/$(basename "$source")" || die
done

rollback() {
  status=$?
  if test "$status" -ne 0; then
    if ! quiet /usr/bin/systemctl stop baci-savings-drafts-smoke.service baci-savings-drafts.service baci-savings-gateway.service; then
      log rollback-stop failed >&2
      exit 1
    fi
    quiet /usr/bin/install -d -o root -g root -m 0700 "$failed" || true
    for name in binding.json startup-evidence.json; do
      test "$fresh_started" = true && test -f "$config/$name" && quiet /usr/bin/mv -- "$config/$name" "$failed/$name" || true
      test -f "$archive/$name" && quiet /usr/bin/cp --preserve=all "$archive/$name" "$config/$name" || true
    done
    test -f "$backup/managed-gateway.mjs" && quiet /usr/bin/cp --preserve=all "$backup/managed-gateway.mjs" "$code/managed-gateway.mjs" || true
    quiet /usr/bin/rm -f -- "$code/managed-private-smoke-runner.mjs" "$code/managed-hosted-draft-renewal-runner.mjs" "$code/managed-hosted-draft-identity.json" || true
    for name in baci-savings-gateway.service baci-savings-drafts.service baci-savings-drafts-smoke.service baci-savings-drafts-deadline.timer; do
      test -f "$backup/$name" && quiet /usr/bin/cp --preserve=all "$backup/$name" "/etc/systemd/system/$name" || true
    done
    quiet /usr/bin/systemctl daemon-reload || true
    quiet /usr/bin/systemctl restart baci-savings-drafts-deadline.timer || true
    log "$stage" failed >&2
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM

stage=archive-expired-evidence
for name in binding.json startup-evidence.json; do
  test -f "$config/$name" && test ! -L "$config/$name" || die
  test "$(/usr/bin/stat -c '%u:%h' "$config/$name")" = '0:1' || die
  quiet /usr/bin/cp --preserve=all -- "$config/$name" "$archive/$name" || die
done
quiet /usr/bin/rm -f -- "$config/binding.json" "$config/startup-evidence.json" || die

stage=install-sealed-runtime
group_id=$(/usr/bin/getent group baci-savings-ingress | /usr/bin/awk -F: '{print $3}')
user_id=$(/usr/bin/id -u baci-savings-gateway)
test -n "$group_id" && test -n "$user_id" || die
for name in managed-gateway.mjs managed-private-smoke-runner.mjs managed-hosted-draft-renewal-runner.mjs managed-hosted-draft-identity.json; do
  quiet /usr/bin/install -o root -g "$group_id" -m 0440 "$bundle/$name" "$code/$name" || die
done
quiet /usr/bin/install -o root -g root -m 0644 "$bundle/baci-savings-gateway.service" "$gateway_unit" || die
quiet /usr/bin/systemctl daemon-reload || die

stage=fresh-private-smoke
fresh_started=true
quiet /usr/bin/node "$code/managed-hosted-draft-renewal-runner.mjs" --renew "$user_id" "$group_id" || die
set -- $(/usr/bin/python3 - "$config/binding.json" <<'PY'
import json, sys
from datetime import datetime
binding = json.load(open(sys.argv[1]))
start = int(datetime.fromisoformat(binding['leaseNotBefore'].replace('Z', '+00:00')).timestamp())
end = int(datetime.fromisoformat(binding['leaseExpiresAt'].replace('Z', '+00:00')).timestamp())
if end - start != 604800: raise SystemExit(1)
print(start, end)
PY
) || die
activated_at=$1
expires_at=$2

stage=renew-draft-units
/usr/bin/python3 - "$draft_unit" "$smoke_unit" "$timer_unit" "$expires_at" <<'PY' >/dev/null 2>&1
import pathlib, sys
from datetime import UTC, datetime
draft_path, smoke_path, timer_path = map(pathlib.Path, sys.argv[1:4]); expiry = sys.argv[4]
old = "ExecCondition=/bin/sh -c '[ \"$(/bin/date -u +%%s)\" -lt 1789989845 ]'\n"
for path, original_runtime, new_runtime in ((draft_path, 'RuntimeMaxSec=1d\n', 'RuntimeMaxSec=7d\n'), (smoke_path, 'RuntimeMaxSec=120\n', 'RuntimeMaxSec=120\n')):
    text = path.read_text()
    if text.count(old) != 1 or text.count(original_runtime) != 1: raise SystemExit(1)
    path.write_text(text.replace(old, old.replace('1789989845', expiry)).replace(original_runtime, new_runtime))
timer = timer_path.read_text(); old_timer = 'OnCalendar=2026-09-21 11:24:05 UTC\n'
if timer.count(old_timer) != 1: raise SystemExit(1)
timer_path.write_text(timer.replace(old_timer, 'OnCalendar=' + datetime.fromtimestamp(int(expiry), UTC).strftime('%Y-%m-%d %H:%M:%S UTC') + '\n'))
PY
quiet /usr/bin/systemctl daemon-reload || die
quiet /usr/bin/systemctl restart baci-savings-drafts-deadline.timer || die
quiet /usr/bin/systemctl is-active --quiet baci-savings-drafts-deadline.timer || die
next=$(/usr/bin/systemctl show baci-savings-drafts-deadline.timer -p NextElapseUSecRealtime --value)
test "$(/bin/date -u -d "$next" +%s)" = "$expires_at" || die

stage=draft-smoke-readiness
quiet /usr/bin/systemctl start baci-savings-drafts-smoke.service || die
ready=false; attempt=0
while test "$attempt" -lt 30; do
  status=$(/usr/bin/curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 -H 'Host: staging.ogabassey.com' http://127.0.0.1:4794/api/storefront/customer/savings/drafts 2>/dev/null || true)
  test "$status" = 401 && { ready=true; break; }
  attempt=$((attempt + 1)); /bin/sleep 1
done
test "$ready" = true || die
quiet /usr/bin/systemctl stop baci-savings-drafts-smoke.service || die
quiet /usr/bin/systemctl start baci-savings-drafts.service || die
ready=false; attempt=0
while test "$attempt" -lt 30; do
  status=$(/usr/bin/curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 -H 'Host: staging.ogabassey.com' http://127.0.0.1:4792/api/storefront/customer/savings/drafts 2>/dev/null || true)
  test "$status" = 401 && { ready=true; break; }
  attempt=$((attempt + 1)); /bin/sleep 1
done
test "$ready" = true || die
quiet /usr/bin/systemctl is-active --quiet baci-savings-gateway.service || die
quiet /usr/bin/systemctl is-active --quiet baci-savings-drafts.service || die

stage=renewal-receipt
set -C
printf '{"version":1,"activatedAt":%s,"expiresAt":%s,"predecessorReceiptSha256":"%s","archivedEvidence":{"bindingSha256":"%s","startupEvidenceSha256":"%s"}}\n' "$activated_at" "$expires_at" "$old_receipt" "$(hash "$archive/binding.json")" "$(hash "$archive/startup-evidence.json")" > "$state/renewal-receipt.json"
quiet /usr/bin/chown root:root "$state/renewal-receipt.json" || die
quiet /usr/bin/chmod 0600 "$state/renewal-receipt.json" || die
trap - EXIT HUP INT TERM
log complete active
