#!/bin/sh
set -eu
umask 077

bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
manifest_sha=c9070cc7d01a316a72f2392c61394ba2fd6320bebabbda20508b1757bf3ec1cf
remote=bassey@82.29.190.219
stage=/home/bassey/baci-week-connectivity-20260930-c9070cc7d01a
names='activation_owner.py activation_preparation.py activation_credentials.py activation_evidence.py activation-funding-role.sql renewal_contract.py renewal_io.py renewal_owner.py renewal_diagnostic.py renewal_inventory.py renewal-inventory.sql renewal-receipt-inventory.sql README-evidence.md connectivity_owner.py connectivity_contract.py connectivity_io.py connectivity_runtime.py connectivity_transaction.py connectivity_role.py connectivity-role.sql connectivity_listeners.py gateway-proof.mjs README-connectivity.md ACTIVATION_SHA256SUMS CONNECTIVITY_SHA256SUMS'
action=${1:---verify-stage}
test "$#" -le 1 || exit 1
test "$(/usr/bin/shasum -a 256 "$bundle/CONNECTIVITY_SHA256SUMS" | /usr/bin/awk '{print $1}')" = "$manifest_sha"

source_file() {
  case "$1" in
    renewal_inventory.py|renewal-inventory.sql|renewal-receipt-inventory.sql)
      printf '%s/../prefunded-card/%s' "$bundle" "$1" ;;
    *) printf '%s/%s' "$bundle" "$1" ;;
  esac
}

while read -r expected name; do
  test "$(/usr/bin/shasum -a 256 "$(source_file "$name")" | /usr/bin/awk '{print $1}')" = "$expected"
done < "$bundle/CONNECTIVITY_SHA256SUMS"

verify_remote() {
  /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote" "set -eu
test ! -L '$stage'
test \"\$(stat -c '%u:%a' '$stage')\" = \"\$(id -u):700\"
test \"\$(find '$stage' -mindepth 1 -maxdepth 1 | wc -l)\" = 25
for name in $names; do
  test ! -L '$stage'/\"\$name\"
  test \"\$(stat -c '%u:%a:%h' '$stage'/\"\$name\")\" = \"\$(id -u):400:1\"
done
test \"\$(sha256sum '$stage/CONNECTIVITY_SHA256SUMS' | awk '{print \$1}')\" = '$manifest_sha'
cd '$stage'
sha256sum -c CONNECTIVITY_SHA256SUMS >/dev/null"
}

owner_command() {
  cat <<EOF
sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PYTHONDONTWRITEBYTECODE=1 /bin/bash -c 'set -euo pipefail
umask 077
source_dir=$stage
test ! -L "\$source_dir"
test "\$(stat -c "%u:%a" "\$source_dir")" = "\$(id -u bassey):700"
test "\$(find "\$source_dir" -mindepth 1 -maxdepth 1 | wc -l)" = 25
for name in $names; do
  test ! -L "\$source_dir/\$name"
  test "\$(stat -c "%u:%a:%h" "\$source_dir/\$name")" = "\$(id -u bassey):400:1"
done
test "\$(sha256sum "\$source_dir/CONNECTIVITY_SHA256SUMS" | cut -d " " -f 1)" = "$manifest_sha"
(cd "\$source_dir" && sha256sum -c CONNECTIVITY_SHA256SUMS >/dev/null)
root_dir=\$(mktemp -d /root/baci-connectivity-renewal.XXXXXXXX)
for name in $names; do install -o root -g root -m 0400 "\$source_dir/\$name" "\$root_dir/\$name"; done
test "\$(sha256sum "\$root_dir/CONNECTIVITY_SHA256SUMS" | cut -d " " -f 1)" = "$manifest_sha"
cd "\$root_dir"
sha256sum -c CONNECTIVITY_SHA256SUMS >/dev/null
python3 -B ./connectivity_owner.py --bundle-sha256 $manifest_sha'
EOF
}

case "$action" in
  --stage)
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote" "umask 077; mkdir -m 0700 -- '$stage'"
    set --
    for name in $names; do set -- "$@" "$(source_file "$name")"; done
    /usr/bin/scp -q "$@" "$remote:$stage/"
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote" "chmod 0400 -- '$stage/'*"
    verify_remote
    printf 'Connectivity renewal source staged at %s\n' "$stage"
    ;;
  --verify-stage)
    verify_remote
    printf 'Connectivity renewal source verified at %s\n' "$stage"
    ;;
  --print-owner-command) owner_command ;;
  --activate)
    printf 'Connectivity renewal only. No card payment, financial replay or paid-interest activation.\n'
    verify_remote
    command=$(owner_command)
    /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 "$remote" "$command"
    ;;
  *) printf 'Refused: reviewed connectivity actions only.\n' >&2; exit 1 ;;
esac
