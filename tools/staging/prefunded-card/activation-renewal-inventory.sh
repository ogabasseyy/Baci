#!/bin/sh
set -eu
exec /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 bassey@82.29.190.219 'sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PYTHONDONTWRITEBYTECODE=1 /bin/bash -c '"'"'set -euo pipefail
umask 077
root_dir=$(/usr/bin/mktemp -d /root/baci-week-renewal-inventory.XXXXXXXX)
/usr/bin/install -o root -g root -m 0600 /home/bassey/baci-week-renewal-inventory-20260929-4d9f71535a6d/renewal_inventory.py "$root_dir/renewal_inventory.py"
/usr/bin/install -o root -g root -m 0600 /home/bassey/baci-week-renewal-inventory-20260929-4d9f71535a6d/renewal-inventory.sql "$root_dir/renewal-inventory.sql"
/usr/bin/install -o root -g root -m 0600 /home/bassey/baci-week-renewal-inventory-20260929-4d9f71535a6d/renewal-receipt-inventory.sql "$root_dir/renewal-receipt-inventory.sql"
cd "$root_dir"
/usr/bin/printf '"'"'"'"'"'"'"'"'%s  %s\n'"'"'"'"'"'"'"'"' 4d9f71535a6d47080a711d7a7e6cbeb06909a4c86627732721abf90ffc242322 renewal_inventory.py 1eb2642597fa3e3c8a40dfa78fe4570f2a8d1168db3aa2d3175450a9cff389f6 renewal-inventory.sql 93d651f746cd1cd254555f64dfbf140388538cee8570d02e2e486601bd52b7aa renewal-receipt-inventory.sql | /usr/bin/sha256sum -c -
/usr/bin/python3 -B ./renewal_inventory.py | /usr/bin/tee "$root_dir/inventory-result.txt"
/usr/bin/printf '"'"'"'"'"'"'"'"'Private diagnostic retained: %s\n'"'"'"'"'"'"'"'"' "$root_dir"
'"'"''
