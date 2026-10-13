#!/bin/sh
set -eu
exec /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 bassey@82.29.190.219 'sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/bash -c '"'"'set -euo pipefail
umask 077
bundle=/root/baci-checkout-retirement.Tp7gsQHh
[[ -d "$bundle" && ! -L "$bundle" && $(/usr/bin/stat -c '"'"'"'"'"'"'"'"'%u:%g:%a'"'"'"'"'"'"'"'"' "$bundle") = 0:0:700 ]]
cd "$bundle"
printf '"'"'"'"'"'"'"'"'%s  SHA256SUMS\n'"'"'"'"'"'"'"'"' 9c77e2ce7c882bb42d8a84b97e73baca3650adae7821877b0fbf0536d22fdf1f | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
root_dir=$(/usr/bin/mktemp -d /root/baci-checkout-rehearsal.XXXXXXXX)
/usr/bin/install -o root -g root -m 0600 /home/bassey/baci-checkout-rehearsal-20260929-27299f0505e6/checkout_retirement_rehearsal.py "$root_dir/checkout_retirement_rehearsal.py"
printf '"'"'"'"'"'"'"'"'%s  %s\n'"'"'"'"'"'"'"'"' 27299f0505e61d9caedbdbcfb84f918196d82ec8c26f51804a154e0d8897f7dd "$root_dir/checkout_retirement_rehearsal.py" | /usr/bin/sha256sum -c -
/usr/bin/install -o root -g root -m 0600 /home/bassey/baci-checkout-rehearsal-20260929-27299f0505e6/checkout_retirement_state_diagnostic.py "$root_dir/checkout_retirement_state_diagnostic.py"
printf '"'"'"'"'"'"'"'"'%s  %s\n'"'"'"'"'"'"'"'"' 2728879338b81f725fd0f7107ffe6cc548c15d33d1701de43e4c44abec08d196 "$root_dir/checkout_retirement_state_diagnostic.py" | /usr/bin/sha256sum -c -
/usr/bin/python3 -I -B -c '"'"'"'"'"'"'"'"'import sys; sys.path.insert(0,sys.argv[1]); sys.path.insert(0,sys.argv[2]); from checkout_retirement_rehearsal import main; main(sys.argv[1])'"'"'"'"'"'"'"'"' "$bundle" "$root_dir"
'"'"''
