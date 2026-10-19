#!/usr/bin/env bash
set -euo pipefail

readonly HERE="$(cd "$(dirname "$0")" && pwd)"
readonly VPS_TARGET='bassey@82.29.190.219'
readonly DIAGNOSTIC='activation-owner-diagnostic.py'
readonly DIAGNOSTIC_CHECKSUMS='activation-owner-diagnostic.SHA256SUMS'

usage() {
  cat <<'EOF'
Usage: bash tools/staging/prefunded-card/activation-preflight.sh

Stages the checksum-pinned, root-only read-only diagnostic and opens an
interactive owner-sudo session. It does not deploy, change configuration,
enable a flag, reload a service, or make a database or provider mutation.
EOF
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi
if (($# != 0)); then
  usage >&2
  exit 64
fi

(
  cd "$HERE"
  shasum -a 256 -c "$DIAGNOSTIC_CHECKSUMS"
)

diagnostic_sha256="$(shasum -a 256 "$HERE/$DIAGNOSTIC" | awk '{print $1}')"
readonly diagnostic_sha256
remote_stage="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_TARGET" '/usr/bin/env bash -s' <<'REMOTE_SH'
set -euo pipefail
umask 077
stage="$(/usr/bin/mktemp -d /tmp/baci-prefunded-card-owner-diagnostic.XXXXXXXX)"
if [[ ! "$stage" =~ ^/tmp/baci-prefunded-card-owner-diagnostic\.[A-Za-z0-9]{8,}$ ]]; then
  exit 1
fi
printf '%s\n' "$stage"
REMOTE_SH
)"
if [[ ! "$remote_stage" =~ ^/tmp/baci-prefunded-card-owner-diagnostic\.[A-Za-z0-9]{8,}$ ]]; then
  echo 'Remote staging path was refused.' >&2
  exit 1
fi
readonly remote_stage

scp "$HERE/$DIAGNOSTIC" "$VPS_TARGET:$remote_stage/$DIAGNOSTIC"

remote_command="$(cat <<EOF
set -euo pipefail
expected_sha='$diagnostic_sha256'
root_stage="\$(sudo /usr/bin/mktemp -d /root/baci-prefunded-card-owner-diagnostic.XXXXXXXX)"
if [[ ! "\$root_stage" =~ ^/root/baci-prefunded-card-owner-diagnostic\.[A-Za-z0-9]{8,}$ ]]; then
  exit 1
fi
sudo /usr/bin/install -o root -g root -m 0500 '$remote_stage/$DIAGNOSTIC' "\$root_stage/$DIAGNOSTIC"
sudo /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/sh -c "cd '\$root_stage' && printf '%s  %s\\n' '\$expected_sha' '$DIAGNOSTIC' | /usr/bin/sha256sum -c - && exec /usr/bin/python3 '$DIAGNOSTIC' --check"
EOF
)"
printf -v quoted_remote_command '%q' "$remote_command"
ssh -tt "$VPS_TARGET" "/usr/bin/env bash -c $quoted_remote_command"
