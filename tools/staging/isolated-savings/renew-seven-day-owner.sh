#!/bin/sh
set -eu

test "$#" = 0 || { printf '%s\n' 'Usage: run without arguments.' >&2; exit 64; }
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
host=bassey@82.29.190.219
remote=/home/bassey/baci-isolated-savings/renewal-seven-day-reviewed
root=/root/baci-savings-renewal-seven-day-$(/bin/date -u +%s)
files='SHA256SUMS managed-install-manifest.json managed-gateway.mjs managed-private-smoke-runner.mjs managed-hosted-draft-renewal-runner.mjs managed-hosted-draft-identity.json baci-savings-gateway.service renew-seven-day-owner-root.sh'

(cd "$bundle" && /usr/bin/shasum -a 256 -c SHA256SUMS >/dev/null)
manifest_hash=$(/usr/bin/shasum -a 256 "$bundle/SHA256SUMS" | /usr/bin/awk '{print $1}')
/usr/bin/ssh -o BatchMode=yes "$host" "/usr/bin/install -d -m 0700 '$remote'"
(cd "$bundle" && /usr/bin/tar -cf - $files) | /usr/bin/ssh -o BatchMode=yes "$host" "umask 077; /usr/bin/tar -C '$remote' -xf -; cd '$remote'; /usr/bin/sha256sum -c SHA256SUMS >/dev/null"
/usr/bin/ssh -tt -o ServerAliveInterval=15 "$host" "sudo /usr/bin/test ! -e '$root' && sudo /usr/bin/install -d -o root -g root -m 0700 '$root' && sudo /usr/bin/install -o root -g root -m 0600 '$remote/SHA256SUMS' '$root/SHA256SUMS' && sudo /usr/bin/install -o root -g root -m 0400 '$remote/managed-install-manifest.json' '$remote/managed-gateway.mjs' '$remote/managed-private-smoke-runner.mjs' '$remote/managed-hosted-draft-renewal-runner.mjs' '$remote/managed-hosted-draft-identity.json' '$remote/baci-savings-gateway.service' '$root/' && sudo /usr/bin/install -o root -g root -m 0500 '$remote/renew-seven-day-owner-root.sh' '$root/renew-seven-day-owner-root.sh' && sudo /bin/sh -c 'cd $root && echo $manifest_hash\ \ SHA256SUMS | /usr/bin/sha256sum -c - >/dev/null && /usr/bin/sha256sum -c SHA256SUMS >/dev/null' && sudo '$root/renew-seven-day-owner-root.sh'"
