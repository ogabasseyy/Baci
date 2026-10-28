#!/usr/bin/env bash
# Fixed broker-owned lease wrapper. Install this beside
# quiesce-worker-release-strict.sh and strict-lock-keeper.py in a root-owned,
# non-writable directory. The broker keeps this process alive across its
# promote -> health/rollback requests. EOF, a bounded lease timeout, or broker
# shutdown exits the shell and lets the strict helper's EXIT trap release
# held inode locks and restart only services it stopped.
set -euo pipefail

readonly helper_dir='/usr/local/lib/baci-worker-broker'
readonly worker_root='/srv/baci-workers'

trap 'exit 0' HUP INT TERM
# shellcheck source=quiesce-worker-release-strict.sh
. "$helper_dir/quiesce-worker-release-strict.sh"
strict_worker_release_quiesce "$worker_root"
printf 'READY\n'

# The broker sends no commands or callback payloads. Keeping stdin open is the
# lease; EOF means the broker has completed or abandoned this release run.
while IFS= read -r _line; do
  printf 'unexpected lease input\n' >&2
  exit 1
done
