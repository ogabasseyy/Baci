const files = [
  'public-install-owner.py',
  'public_installation.py',
  'public_install_io.py',
  'public_projection.py',
  'public_artifact.py',
  'public_database_contract.py',
  'public_service_contract.py',
  'public_nginx_transform.py',
  'public_nginx_installation.py',
  'public_http_probes.py',
  'public_owner_diagnostic.py',
  'runtime_owner_support.py',
  'runtime_activation_sql.py',
  'treasury_owner_contract.py',
  'treasury_owner_io.py',
  'public-app.tar.gz',
  'public-app.manifest.json',
];

function quote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderPublicOwnerCommand(pins) {
  if (
    !/^\/home\/bassey\/baci-public-checkout-20260928(?:-r[0-9]+)?$/.test(
      pins.directory
    ) ||
    ['runner', 'checksums', 'archive', 'manifest'].some(
      (name) => !/^[a-f0-9]{64}$/.test(pins[name])
    )
  ) {
    throw new Error('Owner bundle pin refused');
  }
  const bootstrap = `set -euo pipefail; umask 077; root_dir=$(/usr/bin/mktemp -d /root/baci-public-checkout.XXXXXXXX); /usr/bin/install -o root -g root -m 0600 ${pins.directory}/run-reviewed.sh "$root_dir/run-reviewed.sh"; printf '%s  %s\\n' ${pins.runner} "$root_dir/run-reviewed.sh" | /usr/bin/sha256sum -c -; exec /bin/bash "$root_dir/run-reviewed.sh"`;
  const remote = `sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/bash -c ${quote(bootstrap)}`;
  const mac = `#!/bin/sh\nset -eu\nexec /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 bassey@82.29.190.219 ${quote(remote)}\n`;
  const runner = `#!/bin/bash
set -euo pipefail
umask 077
[ "$(/usr/bin/id -u)" -eq 0 ]
root_dir=$(cd -- "$(/usr/bin/dirname -- "$0")" && /bin/pwd -P)
case "$root_dir" in /root/baci-public-checkout.*) ;; *) exit 1 ;; esac
source_dir=${quote(pins.directory)}
for name in SHA256SUMS ${files.join(' ')}; do
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
cd "$root_dir"
printf '%s  SHA256SUMS\\n' ${pins.checksums} | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
/usr/bin/python3 -I ./public-install-owner.py --archive "$root_dir/public-app.tar.gz" --archive-sha256 ${pins.archive} --manifest "$root_dir/public-app.manifest.json" --manifest-sha256 ${pins.manifest} --start --activate-nginx | /usr/bin/tee "$root_dir/install-result.txt"
printf '%s\\n' FIRST_CARD_PUBLIC_STAGING_ACTIVE
`;
  return { mac, runner };
}
