#!/bin/sh
set -eu
umask 077

bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
manifest_sha=4fc5fc42c300766d5861dd4c27376524b977d7165b734a0f09daf54d62fb4d34
remote=bassey@82.29.190.219
stage=/home/bassey/baci-week-renewal-a-preparation-20260930-4fc5fc42c300
names='renewal_contract.py renewal_io.py renewal_owner.py renewal_diagnostic.py README.md SHA256SUMS'
action=${1:---verify-stage}
test "$#" -le 1 || exit 1
if test "$action" = --prepare; then
  printf 'Preparation only; does not renew or restart staging\n'
elif test "$action" = --diagnose; then
  printf 'Read-only checks; no renewal, service restart, database write or payment\n'
fi
test "$(/usr/bin/shasum -a 256 "$bundle/SHA256SUMS" | /usr/bin/awk '{print $1}')" = "$manifest_sha"
(cd "$bundle" && /usr/bin/shasum -a 256 -c SHA256SUMS >/dev/null)

verify_remote() {
  /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote" "set -eu
test ! -L '$stage'
test \"\$(stat -c '%u:%a' '$stage')\" = \"\$(id -u):700\"
test \"\$(find '$stage' -mindepth 1 -maxdepth 1 | wc -l)\" = 6
for name in $names; do
  test ! -L '$stage'/\"\$name\"
  test \"\$(stat -c '%u:%a:%h' '$stage'/\"\$name\")\" = \"\$(id -u):400:1\"
done
test \"\$(sha256sum '$stage/SHA256SUMS' | awk '{print \$1}')\" = '$manifest_sha'
cd '$stage'
sha256sum -c SHA256SUMS >/dev/null"
}

owner_command() {
  owner_action=${1:---prepare}
  cat <<EOF
sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PYTHONDONTWRITEBYTECODE=1 /bin/bash -c 'set -euo pipefail
umask 077
source_dir=$stage
test ! -L "\$source_dir"
test "\$(stat -c "%u:%a" "\$source_dir")" = "\$(id -u bassey):700"
for name in $names; do
  test ! -L "\$source_dir/\$name"
  test "\$(stat -c "%u:%a:%h" "\$source_dir/\$name")" = "\$(id -u bassey):400:1"
done
test "\$(sha256sum "\$source_dir/SHA256SUMS" | cut -d " " -f 1)" = "$manifest_sha"
(cd "\$source_dir" && sha256sum -c SHA256SUMS >/dev/null)
root_dir=\$(mktemp -d /root/baci-week-renewal-a.XXXXXXXX)
for name in $names; do install -o root -g root -m 0400 "\$source_dir/\$name" "\$root_dir/\$name"; done
test "\$(sha256sum "\$root_dir/SHA256SUMS" | cut -d " " -f 1)" = "$manifest_sha"
cd "\$root_dir"
sha256sum -c SHA256SUMS >/dev/null
python3 -B ./renewal_owner.py $owner_action --bundle-sha256 $manifest_sha'
EOF
}

case "$action" in
  --stage)
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote" "umask 077; mkdir -m 0700 -- '$stage'"
    for name in $names; do
      /usr/bin/scp -q "$bundle/$name" "$remote:$stage/$name"
    done
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote" "chmod 0400 -- '$stage/'*"
    verify_remote
    printf 'prepared-review-required: source staged only at %s\n' "$stage"
    ;;
  --verify-stage)
    verify_remote
    printf 'prepared-review-required: source closure verified at %s\n' "$stage"
    ;;
  --print-owner-command)
    owner_command
    ;;
  --prepare|--diagnose)
    verify_remote
    command=$(owner_command "$action")
    /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 "$remote" "$command"
    ;;
  *) printf 'Refused: preparation source actions only.\n' >&2; exit 1 ;;
esac
