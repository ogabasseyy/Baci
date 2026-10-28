#!/usr/bin/env bash
set -euo pipefail

# Runs the strict lock keeper and quiesce function as root inside an isolated
# Linux container. The repository mounts are read-only and the container has
# no network; all worker state and systemd/crontab substitutes are disposable.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
docker run --rm -i --network none --user 0 \
  -v "$repo_root/vps-workers/lib:/source/lib:ro" \
  -v "$repo_root/.github/scripts/gigl-dotenv.sh:/source/gigl-dotenv.sh:ro" \
  --entrypoint bash node:24-bookworm -s <<'LINUX_TEST'
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "PASS: $*"; }

command -v python3 >/dev/null || fail 'python3 missing from test image'
command -v runuser >/dev/null || fail 'runuser missing from test image'
command -v flock >/dev/null || fail 'flock missing from test image'

groupadd --system baci-worker
useradd --system --gid baci-worker --home-dir /nonexistent --shell /usr/sbin/nologin baci-worker
worker_uid="$(id -u baci-worker)"
worker_gid="$(id -g baci-worker)"
install -d -o root -g "$worker_gid" -m 0750 /srv/baci-workers
install -d -o root -g "$worker_gid" -m 0750 /srv/baci-workers/locks
install -d -o root -g root -m 0755 /srv/baci-workers/bin
install -m 0644 /source/gigl-dotenv.sh /srv/baci-workers/bin/gigl-dotenv.sh
install -o root -g "$worker_gid" -m 0640 /dev/null /srv/baci-workers/.env
install -o root -g "$worker_gid" -m 0660 /dev/null /srv/baci-workers/locks/ordinary.lock
install -o root -g "$worker_gid" -m 0660 /dev/null /srv/baci-workers/locks/error-remediator-global.lock

temp="$(mktemp -d)"
chmod 0755 "$temp"
trap 'rm -rf "$temp"' EXIT
cat >"$temp/crontab" <<'CRON'
* * * * * flock -n locks/ordinary.lock /usr/bin/true
CRON
cat >"$temp/crontab-bin" <<'CRONTAB'
#!/bin/sh
[ "$1" = -u ] && [ "$2" = baci-worker ] && [ "$3" = -l ] || exit 2
cat "$TEST_CRONTAB"
CRONTAB
cat >"$temp/systemctl" <<'SYSTEMCTL'
#!/bin/sh
echo "$*" >> "$SYSTEMCTL_LOG"
if [ "$1" = is-active ]; then
  [ "$3" = baci-domain-event-router ] && exit 0
  [ "$3" = baci-event-delivery-worker ] && exit 3
  [ "$3" = baci-quiz-finalization ] && exit 3
  exit 4
fi
exit 0
SYSTEMCTL
chmod +x "$temp/crontab-bin" "$temp/systemctl"
mkdir "$temp/bin"
ln -s "$temp/crontab-bin" "$temp/bin/crontab"
ln -s "$temp/systemctl" "$temp/bin/systemctl"
export PATH="$temp/bin:$PATH" TEST_CRONTAB="$temp/crontab" SYSTEMCTL_LOG="$temp/systemctl.log"
: >"$SYSTEMCTL_LOG"

# Exercise the keeper's real Linux flock lifetime independently from the
# quiesce wrapper so an IPC regression cannot hide it.
keeper_ipc="$temp/keeper-ipc"
mkdir "$keeper_ipc"
chmod 0755 "$keeper_ipc"
mkfifo -m 0666 "$keeper_ipc/ready" "$keeper_ipc/release"
runuser -u baci-worker -- python3 /source/lib/strict-lock-keeper.py \
  /srv/baci-workers/locks/ordinary.lock "$worker_uid" "$worker_gid" \
  "$keeper_ipc/ready" "$keeper_ipc/release" &
keeper_pid=$!
IFS= read -r ready <"$keeper_ipc/ready"
[ "$ready" = READY ] || fail 'keeper did not signal readiness'
exec 9>"$keeper_ipc/release"
if flock -n /srv/baci-workers/locks/ordinary.lock -c true; then
  fail 'keeper did not retain flock while its release pipe was open'
fi
exec 9>&-
wait "$keeper_pid" || fail 'keeper did not exit cleanly after release'
flock -n /srv/baci-workers/locks/ordinary.lock -c true || fail 'keeper retained flock after release'
ok 'keeper holds its exact flock descriptor until release and then unlocks'

# Reject unsafe inodes against real Linux ownership/mode checks.
printf sentinel >/tmp/strict-lock-outside
ln -s /tmp/strict-lock-outside /srv/baci-workers/locks/linked.lock
if runuser -u baci-worker -- python3 /source/lib/strict-lock-keeper.py \
  /srv/baci-workers/locks/linked.lock "$worker_uid" "$worker_gid" /dev/null /dev/null >/dev/null 2>&1; then
  fail 'keeper accepted a symlinked lock leaf'
fi
ln -s /tmp /srv/baci-workers/linked-parent
if runuser -u baci-worker -- python3 /source/lib/strict-lock-keeper.py \
  /srv/baci-workers/linked-parent/created.lock "$worker_uid" "$worker_gid" /dev/null /dev/null >/dev/null 2>&1; then
  fail 'keeper accepted a symlinked path component'
fi
[ "$(cat /tmp/strict-lock-outside)" = sentinel ] || fail 'symlink target was modified'
[ ! -e /tmp/created.lock ] || fail 'symlinked parent target was created'
ok 'keeper rejects leaf and parent symlinks without modifying their targets'

install -o "$worker_uid" -g "$worker_gid" -m 0660 /dev/null /srv/baci-workers/locks/wrong-owner.lock
if runuser -u baci-worker -- python3 /source/lib/strict-lock-keeper.py \
  /srv/baci-workers/locks/wrong-owner.lock "$worker_uid" "$worker_gid" /dev/null /dev/null >/dev/null 2>&1; then
  fail 'keeper accepted a lock owned by the wrong identity'
fi
chmod 0666 /srv/baci-workers/locks/ordinary.lock
if runuser -u baci-worker -- python3 /source/lib/strict-lock-keeper.py \
  /srv/baci-workers/locks/ordinary.lock "$worker_uid" "$worker_gid" /dev/null /dev/null >/dev/null 2>&1; then
  fail 'keeper accepted a group/world-writable lock'
fi
chmod 0660 /srv/baci-workers/locks/ordinary.lock
ok 'keeper rejects wrong-owner and group/world-writable lock inodes'
rm -f /srv/baci-workers/locks/linked.lock /srv/baci-workers/linked-parent \
  /srv/baci-workers/locks/wrong-owner.lock

cat >"$temp/driver" <<'DRIVER'
#!/usr/bin/env bash
set -uo pipefail
source /source/lib/quiesce-worker-release-strict.sh
trap 'echo prior-exit >>"$SYSTEMCTL_LOG"' EXIT
strict_worker_release_quiesce /srv/baci-workers || exit 32
flock -n /srv/baci-workers/locks/ordinary.lock -c true && {
  echo 'quiesce returned without retaining ordinary.lock' >&2
  exit 31
}
echo held-lock-observed
DRIVER
chmod +x "$temp/driver"
output="$(bash "$temp/driver" 2>"$temp/stderr")" || {
  printf '%s\n' "$output" >&2
  cat "$temp/stderr" >&2
  cat "$SYSTEMCTL_LOG" >&2
  fail 'strict quiesce driver failed'
}
grep -q held-lock-observed <<<"$output" || fail 'driver did not observe retained lock'
grep -q '^stop baci-domain-event-router$' "$SYSTEMCTL_LOG" || fail 'active service was not stopped'
grep -q '^start baci-domain-event-router$' "$SYSTEMCTL_LOG" || fail 'stopped service was not restarted on exit'
grep -q '^prior-exit$' "$SYSTEMCTL_LOG" || fail 'prior EXIT trap was not chained'
flock -n /srv/baci-workers/locks/ordinary.lock -c true || fail 'lock remained held after shell exit'
ok 'quiesce retains worker lock through caller lifetime, restarts stopped service, and chains EXIT trap'

LINUX_TEST
