#!/bin/sh
set -eu
exec /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 bassey@82.29.190.219 'sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/bash -c '\''set -euo pipefail
umask 077
source_dir=/home/bassey/baci-interest-policy-20261001-reviewed
root_dir=$(/usr/bin/mktemp -d /root/baci-interest-policy.XXXXXXXX)
/usr/bin/install -o root -g root -m 0600 "$source_dir/POLICY-SHA256SUMS" "$root_dir/POLICY-SHA256SUMS"
printf '\''\'\'''\''%s  %s\n'\''\'\'''\'' '\''\'\'''\''348e3e498b2dab396de2ce96a88c02c3eee66c6b6c739d8937876112be550606'\''\'\'''\'' "$root_dir/POLICY-SHA256SUMS" | /usr/bin/sha256sum -c -
for name in install-policy.py policy-guard.sql 20261001230000_customer_savings_interest_policy.sql; do
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
cd "$root_dir"
/usr/bin/sha256sum -c POLICY-SHA256SUMS
/usr/bin/python3 ./install-policy.py --rehearse | /usr/bin/tee rehearsal-result.json
/usr/bin/python3 ./install-policy.py --apply | /usr/bin/tee install-result.json
printf '\''\'\'''\''INTEREST_POLICY_SCHEMA_READY\nAudit files retained: %s\n'\''\'\'''\'' "$root_dir"'\'''
