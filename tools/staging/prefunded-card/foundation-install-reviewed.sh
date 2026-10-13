#!/usr/bin/env bash
set -euo pipefail

readonly HERE="$(cd "$(dirname "$0")" && pwd)"
readonly EXPECTED_BUNDLE='8d97ef5284022a785af22e191ebbed280826fb7d4acb9f93340bd73a47b76717'
readonly TARGET='bassey@82.29.190.219'

if [[ "${1:-}" == '--help' ]]; then
  printf '%s\n' 'Install the inactive isolated staging SQL foundation. No payment activation, service restart, credentials, or production changes.'
  exit 0
fi
if (($# != 0)) || [[ ! "$EXPECTED_BUNDLE" =~ ^[a-f0-9]{64}$ ]]; then
  printf '%s\n' 'Reviewed foundation bundle is not prepared.' >&2
  exit 1
fi
cd "$HERE"
bundle_contents="$(cat foundation-bundle.SHA256SUMS)"
actual_bundle="$(printf '%s\n' "$bundle_contents" | shasum -a 256 | awk '{print $1}')"
[[ "$actual_bundle" == "$EXPECTED_BUNDLE" ]]
sql_sha="$(printf '%s\n' "$bundle_contents" | awk '$2 == "foundation.sql" {print $1}')"
owner_sha="$(printf '%s\n' "$bundle_contents" | awk '$2 == "foundation-owner.py" {print $1}')"
[[ "$sql_sha" =~ ^[a-f0-9]{64}$ && "$owner_sha" =~ ^[a-f0-9]{64}$ ]]
readonly bundle_contents sql_sha owner_sha
printf '%s\n' "$bundle_contents" | shasum -a 256 -c -

remote_stage="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" '/usr/bin/env bash -s' <<'REMOTE'
set -euo pipefail
umask 077
stage="$(/usr/bin/mktemp -d /tmp/baci-prefunded-foundation.XXXXXXXX)"
[[ "$stage" =~ ^/tmp/baci-prefunded-foundation\.[A-Za-z0-9]{8,}$ ]]
printf '%s\n' "$stage"
REMOTE
)"
[[ "$remote_stage" =~ ^/tmp/baci-prefunded-foundation\.[A-Za-z0-9]{8,}$ ]]
readonly remote_stage
scp foundation.sql foundation-owner.py "$TARGET:$remote_stage/"

remote_command="$(cat <<EOF
set -euo pipefail
expected_sql='$sql_sha'
expected_owner='$owner_sha'
root_stage="\$(sudo /usr/bin/mktemp -d /root/baci-prefunded-foundation.XXXXXXXX)"
[[ "\$root_stage" =~ ^/root/baci-prefunded-foundation\\.[A-Za-z0-9]{8,}$ ]]
sudo /usr/bin/install -o root -g root -m 0400 '$remote_stage/foundation.sql' "\$root_stage/foundation.sql"
sudo /usr/bin/install -o root -g root -m 0400 '$remote_stage/foundation-owner.py' "\$root_stage/foundation-owner.py"
sudo /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/bash -c "cd '\$root_stage' && printf '%s  %s\\n' '\$expected_sql' foundation.sql '\$expected_owner' foundation-owner.py | /usr/bin/sha256sum -c - && exec /usr/bin/python3 foundation-owner.py --install --sql-sha256 '\$expected_sql'"
EOF
)"
printf -v quoted_command '%q' "$remote_command"
ssh -tt -o ServerAliveInterval=15 "$TARGET" "/usr/bin/env bash -c $quoted_command"
