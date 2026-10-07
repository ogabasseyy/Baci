#!/bin/sh
set -eu

PACKAGE=${1:?package directory required}
MANIFEST_SHA256=${2:?manifest sha256 required}
SEAL_SHA256=${3:?package seal sha256 required}
HOST=bassey@82.29.190.219
FILES='README.md artifact_validation.py descriptor_copy.py systemd_identity.py upgrade-savings-drafts.py full-artifact-manifest.json full-artifact-manifest.sha256 reviewed-package.sha256'
for digest in "$MANIFEST_SHA256" "$SEAL_SHA256"; do
  test "${#digest}" -eq 64 || exit 2
  case "$digest" in *[!0-9a-f]*) exit 2;; esac
done
test -d "$PACKAGE" && test ! -L "$PACKAGE" || exit 2
for file in $FILES; do test -f "$PACKAGE/$file" && test ! -L "$PACKAGE/$file" || exit 2; done
test "$(find "$PACKAGE" -maxdepth 1 -type f | wc -l | tr -d ' ')" -eq 8 || exit 2
test "$(sha256sum "$PACKAGE/full-artifact-manifest.json" | awk '{print $1}')" = "$MANIFEST_SHA256" || exit 2
test "$(sha256sum "$PACKAGE/reviewed-package.sha256" | awk '{print $1}')" = "$SEAL_SHA256" || exit 2
(cd "$PACKAGE" && sha256sum -c reviewed-package.sha256) >/dev/null || exit 2
stage=$(ssh "$HOST" 'umask 077; mktemp -d /home/bassey/reviewed-draft-upgrade-XXXXXXXX')
suffix=${stage#/home/bassey/reviewed-draft-upgrade-}
test "$stage" = "/home/bassey/reviewed-draft-upgrade-$suffix" || exit 2
test "${#suffix}" -eq 8 || exit 2
case "$suffix" in *[!A-Za-z0-9]*) exit 2;; esac
tar -C "$PACKAGE" -cf - $FILES | ssh "$HOST" "set -eu; cd '$stage'; tar -xf -; sha256sum -c reviewed-package.sha256 >/dev/null"
printf '%s\n' "Staged for owner review: $stage"
printf '%s\n' "Owner executes after review: sudo sh -c 'set -eu; root=\$(mktemp -d /root/reviewed-draft-upgrade-XXXXXXXX); for file in $FILES; do install -o root -g root -m 600 $stage/\$file \"\$root\"/\$file; done; cd \"\$root\"; test \"\$(sha256sum reviewed-package.sha256 | cut -c 1-64)\" = $SEAL_SHA256; sha256sum -c reviewed-package.sha256; python3 upgrade-savings-drafts.py --upgrade --source /home/bassey/baci-funding-build-20260922-1822/apps/web/.next/standalone --manifest full-artifact-manifest.json --manifest-sha256 $MANIFEST_SHA256'"
