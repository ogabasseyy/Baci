#!/usr/bin/env bash
# Installs the pinned PostgreSQL 18 server and client packages on a GitHub-hosted
# Ubuntu 24.04 runner, from the official PostgreSQL (PGDG) apt repository.
#
# Hosted runners ship PostgreSQL 16 only, while every CI database suite runs on 18.
# Each hosted job that needs the server binaries calls this script instead of
# repeating the repository setup.
#
# Hosted runners only. The self-hosted CI server has no sudo for its runner user and
# keeps the same PostgreSQL 18 build pre-installed in /usr/lib/postgresql/18/bin, so
# callers run this behind `if [ "$RUNNER_ENVIRONMENT" = 'github-hosted' ]` and then only
# verify that the binaries exist. The check below makes a stray call fail instead of
# reaching for sudo.
#
# PG_BUILD is the one place the PostgreSQL 18 release is pinned for hosted runners: the DB Replay
# toolchain script (install-supabase-replay-toolchain.sh) calls this installer too. Keep that script's
# psql check, apps/web/tools/db/supabase-replay-contract.ts and the Disposable SQL service container
# on the same release; ci-hosted-postgresql-contract.test.mjs fails otherwise.
# On the hosted image (which already carries PostgreSQL 16) installing the server package
# creates and starts no database, so nothing binds port 5432 next to a job's service
# container (seen in the DB Replay install log). A bare image would get a default cluster.
#
# Ubuntu mirror outages: hosted runners read Ubuntu packages through /etc/apt/apt-mirrors.txt, Azure's
# mirror first. On 2026-11-11 that mirror stopped answering, and the full `apt-get update` this script used
# to run waited on it for minutes and then failed, which took down every job that installs PostgreSQL while
# the PostgreSQL repository itself answered at once. On the hosted image the server and client packages are
# expected to need nothing from Ubuntu's archive, so the first refresh reads the PGDG source only and
# recommended extras are skipped. Every apt command is bounded in time. Only if the install still fails does
# the script point apt at Ubuntu's own servers, refresh every list once and try one more time.
set -euo pipefail

if [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then
  echo "Refusing to install PostgreSQL packages outside a GitHub-hosted runner." >&2
  exit 1
fi

PG_BUILD='18.6-1.pgdg24.04+2'
PGDG_KEY_URL='https://www.postgresql.org/media/keys/ACCC4CF8.asc'
# Fingerprint of the one "PostgreSQL Debian Repository" signing key.
PGDG_KEY_FINGERPRINT='B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8'
PGDG_KEYRING='/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc'
PGDG_SOURCE='/etc/apt/sources.list.d/pgdg.list'
# Where the hosted image lists its Ubuntu mirrors (see the comment at the top).
UBUNTU_MIRRORS='/etc/apt/apt-mirrors.txt'
# No single apt command may wait longer than this, whatever the mirrors do. A healthy install
# takes well under a minute.
APT_LIMIT_SECONDS=180
# A few seconds per connection, three tries per file, and up to a minute for a dpkg lock that a background
# apt job on a fresh runner, or a command stopped by the ceiling above, may still hold.
APT_BOUNDS=(-o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o DPkg::Lock::Timeout=60)

apt_get() {
  timeout --kill-after=10 "$APT_LIMIT_SECONDS" sudo apt-get "${APT_BOUNDS[@]}" "$@"
}

# Recommended extras are skipped. Checked against the noble-pgdg package index for this build: postgresql-18
# recommends postgresql-18-jit (the JIT library; PostgreSQL turns JIT off for the session when it is absent)
# and sysstat, postgresql-client-18 recommends nothing, and the contrib modules ship inside postgresql-18
# (it provides postgresql-contrib-18). The suites need none of the extras, and they would come from Ubuntu.
install_pinned() {
  apt_get install -y --no-install-recommends "postgresql-18=${PG_BUILD}" "postgresql-client-18=${PG_BUILD}"
}

installed_build() {
  # shellcheck disable=SC2016 # dpkg-query expands ${Version} itself
  dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true
}

# A job may call this more than once; the second call has nothing left to do.
if [ "$(installed_build postgresql-18)" = "$PG_BUILD" ] &&
  [ "$(installed_build postgresql-client-18)" = "$PG_BUILD" ]; then
  echo "PostgreSQL 18 ${PG_BUILD} is already installed."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
  --connect-timeout 15 --max-time 120 --output "$work/pgdg.asc" "$PGDG_KEY_URL"

# Trust the key file only if it holds exactly the expected signing key. Subkeys are
# fine; a second primary key (anything that could also sign the repository) is not.
mkdir -m 700 "$work/gnupg"
fingerprints="$(
  GNUPGHOME="$work/gnupg" gpg --batch --show-keys --with-colons "$work/pgdg.asc" |
    awk -F: '$1 == "pub" { primary = 1; next } $1 == "fpr" && primary { print $10; primary = 0 }'
)" || {
  echo "Could not read the PostgreSQL repository signing key." >&2
  exit 1
}
if [ "$fingerprints" != "$PGDG_KEY_FINGERPRINT" ]; then
  echo "Unexpected PostgreSQL repository signing key: ${fingerprints:-none}" >&2
  exit 1
fi

sudo install -d /usr/share/postgresql-common/pgdg
sudo install -m 0644 "$work/pgdg.asc" "$PGDG_KEYRING"
# https, like the official setup instructions: apt checks the signature either way, but plain http
# would expose which packages the runner fetches. The one-line format is kept on purpose: apt 2.7
# on Ubuntu 24.04 supports it fully, and the current runner image has no other PGDG source file to clash with.
echo "deb [signed-by=${PGDG_KEYRING}] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" |
  sudo tee "$PGDG_SOURCE" >/dev/null

# Refresh only the PGDG index first: it is all the two packages should need, and it keeps an unreachable
# Ubuntu mirror out of the way. List-Cleanup=0 leaves the Ubuntu lists as they are. If that refresh or the
# install fails (a dependency has to come from Ubuntu's archive, or the refresh itself broke), switch to
# Ubuntu's own servers once and refresh every list. Azure stays on the list as the last choice.
if ! { apt_get -o Dir::Etc::sourcelist="$PGDG_SOURCE" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 update && install_pinned; }; then
  echo "The PostgreSQL-only refresh or the install failed; switching to the canonical Ubuntu mirrors and refreshing every list once."
  printf 'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:3\n' |
    sudo tee "$UBUNTU_MIRRORS" >/dev/null
  { apt_get update && install_pinned; } || {
    echo "Could not install PostgreSQL 18 ${PG_BUILD}, not even from the canonical Ubuntu mirrors." >&2
    exit 1
  }
fi
