#!/usr/bin/env bash
# Metadata-only acceptance probe for the dedicated release/worker identities.
# Run on the staging or production host as root after provisioning. It never
# reads or prints credential contents.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run this verifier as root so identity checks are authoritative.' >&2
  exit 2
fi

RELEASE_USER=baci-release
WORKER_USER=baci-worker
GITHUB_CREDENTIAL=/home/bassey/.config/gh/hosts.yml
RELEASE_HOME=/home/baci-release
RELEASE_WORKSPACE=/home/baci-release/actions-runner/_work
WORKER_ROOT=/srv/baci-workers
WORKER_ENV=/srv/baci-workers/runtime/worker.env
SAFE_PATH=/usr/sbin:/usr/bin:/sbin:/bin
failures=0

fail() {
  echo "FAIL: $1" >&2
  failures=$((failures + 1))
}

check_identity() {
  local user="$1"
  if ! id "$user" >/dev/null 2>&1; then
    fail "$user account exists"
    return 1
  fi
  echo "PASS: $user account exists"
  local groups
  groups="$(id -Gn "$user")" || { fail "$user groups are readable"; return 1; }
  case " $groups " in *' docker '*) fail "$user is not in docker" ;; *) echo "PASS: $user is not in docker" ;; esac
  case " $groups " in *' sudo '*) fail "$user is not in sudo" ;; *) echo "PASS: $user is not in sudo" ;; esac
}

can_read_as() {
  local user="$1" path="$2"
  sudo -n -u "$user" -- /usr/bin/env -i HOME="$(getent passwd "$user" | cut -d: -f6)" PATH="$SAFE_PATH" \
    /usr/bin/test -r "$path" >/dev/null 2>&1
}

can_write_as() {
  local user="$1" path="$2"
  sudo -n -u "$user" -- /usr/bin/env -i HOME="$(getent passwd "$user" | cut -d: -f6)" PATH="$SAFE_PATH" \
    /usr/bin/test -w "$path" >/dev/null 2>&1
}

check_identity "$RELEASE_USER" || true
check_identity "$WORKER_USER" || true

for user in "$RELEASE_USER" "$WORKER_USER"; do
  if ! sudo -n -u "$user" -- /usr/bin/true >/dev/null 2>&1; then
    fail "passwordless verifier access to $user"
  fi
done

if can_read_as "$RELEASE_USER" "$GITHUB_CREDENTIAL"; then fail 'release cannot read persisted GitHub credential'; else echo 'PASS: release cannot read persisted GitHub credential'; fi
if can_read_as "$WORKER_USER" "$GITHUB_CREDENTIAL"; then fail 'worker cannot read persisted GitHub credential'; else echo 'PASS: worker cannot read persisted GitHub credential'; fi
if can_write_as "$WORKER_USER" "$GITHUB_CREDENTIAL"; then fail 'worker cannot write persisted GitHub credential'; else echo 'PASS: worker cannot write persisted GitHub credential'; fi
if can_read_as "$WORKER_USER" "$RELEASE_WORKSPACE"; then fail 'worker cannot read release workspace'; else echo 'PASS: worker cannot read release workspace'; fi
if can_read_as "$RELEASE_USER" "$WORKER_ENV"; then fail 'release cannot read worker runtime environment'; else echo 'PASS: release cannot read worker runtime environment'; fi
if can_write_as "$RELEASE_USER" "$WORKER_ROOT"; then fail 'release cannot write worker root'; else echo 'PASS: release cannot write worker root'; fi
if can_read_as "$WORKER_USER" "$WORKER_ENV"; then echo 'PASS: worker can read worker runtime environment'; else fail 'worker can read worker runtime environment'; fi

for path in "$RELEASE_HOME/.config/gh/hosts.yml" "$RELEASE_WORKSPACE/.config/gh/hosts.yml"; do
  if [ -e "$path" ]; then fail "no persisted GitHub CLI credential at $path"; else echo "PASS: no persisted GitHub CLI credential at $path"; fi
done

if [ "$failures" -ne 0 ]; then
  echo "Credential isolation failed: $failures check(s)." >&2
  exit 1
fi
echo 'Credential isolation acceptance checks passed.'
