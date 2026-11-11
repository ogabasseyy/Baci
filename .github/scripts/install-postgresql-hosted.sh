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

sudo apt-get -o Acquire::Retries=3 update
sudo apt-get -o Acquire::Retries=3 install -y \
  "postgresql-18=${PG_BUILD}" "postgresql-client-18=${PG_BUILD}"
