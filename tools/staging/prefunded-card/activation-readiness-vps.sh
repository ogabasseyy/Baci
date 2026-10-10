#!/usr/bin/env bash
set -euo pipefail
readonly HERE="$(cd "$(dirname "$0")" && pwd)"
[[ $# == 0 && "$HERE" =~ ^/tmp/baci-prefunded-readiness\.[A-Za-z0-9]{8,}$ ]]
umask 077
/usr/bin/sudo /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C \
  /usr/bin/bash -c '
set -euo pipefail
[[ $# == 1 && "$1" =~ ^/tmp/baci-prefunded-readiness\.[A-Za-z0-9]{8,}$ ]]
stage="$(/usr/bin/mktemp -d /root/baci-prefunded-readiness.XXXXXXXX)"
/usr/bin/install -o root -g root -m 0400 "$1/activation-readiness.sql" "$stage/activation-readiness.sql"
/usr/bin/install -o root -g root -m 0400 "$1/activation-readiness-owner.py" "$stage/activation-readiness-owner.py"
cd "$stage"
printf "%s  %s\n" \
  ff3332f1b0902b9aa6fcc0f18788bd9a6af081f81d7f153a7ed4e18c8634e165 activation-readiness.sql \
  245645f7153f267fd184341e6a62552260271d75f5f7aca7f2f8a2d75a03eaaf activation-readiness-owner.py \
  | /usr/bin/sha256sum -c -
exec /usr/bin/python3 -I activation-readiness-owner.py
' readiness "$HERE" | tee "$HERE/readiness-result.txt"
