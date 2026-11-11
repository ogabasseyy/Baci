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
# the PostgreSQL repository itself answered at once. The server and client packages need almost nothing from
# Ubuntu's archive (on the hosted image only liburing2), so the first refresh reads the PGDG source only and
# recommended extras are skipped. Every apt command is bounded in time. Only if that fails does the script
# put independent Ubuntu mirrors ahead of Canonical's own, refresh every list once and try one more time.
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
# The fallback list, best first. Two independent full mirrors lead: on 2026-11-11 Canonical's own servers
# (archive.ubuntu.com, security.ubuntu.com) did not answer either, and liburing2, the one package the
# PostgreSQL 18 build needs from Ubuntu, could not be fetched. apt checks the archive signatures on every
# mirror, so an independent mirror is as trustworthy as Canonical's. Azure's mirror stays as the last choice.
# Checked on 2026-11-11: every mirror below answers over https, with a valid certificate, for noble,
# noble-updates, noble-security and noble-backports (Azure's too, although older documentation lists it as http only).
FALLBACK_MIRRORS=(
  https://mirrors.edge.kernel.org/ubuntu/
  https://ubuntu.osuosl.org/ubuntu/
  https://archive.ubuntu.com/ubuntu/
  https://security.ubuntu.com/ubuntu/
  https://azure.archive.ubuntu.com/ubuntu/
)
# No single apt command may wait longer than this, whatever the mirrors do. A healthy install
# takes well under a minute.
APT_LIMIT_SECONDS=180
# A few seconds per connection, three tries per file, and up to a minute for a dpkg lock that a background
# apt job on a fresh runner, or a command stopped by the ceiling above, may still hold.
APT_BOUNDS=(-o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o DPkg::Lock::Timeout=60)

# timeout runs under sudo, so its signal, and the kill after ten seconds, goes to apt-get itself. Wrapped around
# sudo it could stop only sudo and leave apt-get running with the dpkg lock held.
apt_get() {
  sudo timeout --kill-after=10 "$APT_LIMIT_SECONDS" apt-get "${APT_BOUNDS[@]}" "$@"
}

# Recommended extras are skipped. Checked against the noble-pgdg package index for 18.6-1.pgdg24.04+2:
# postgresql-18 recommends postgresql-18-jit (the JIT library; PostgreSQL turns JIT off for the session when
# it is absent) and sysstat, postgresql-client-18 recommends nothing, and the contrib modules ship inside
# postgresql-18 (it provides postgresql-contrib-18). The suites need none of the extras, and they would come
# from Ubuntu. The metadata itself is kept in install-postgresql-hosted.package-metadata.txt. Re-check this list
# whenever PG_BUILD changes: ci-hosted-postgresql-contract.test.mjs fails until that file and the build named
# here match PG_BUILD, so the next audit is a diff.
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
# install fails (a dependency has to come from Ubuntu's archive, or the refresh itself broke), switch to the
# fallback mirror list once and refresh every list.
failed_step=''
if ! apt_get -o Dir::Etc::sourcelist="$PGDG_SOURCE" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 update; then
  failed_step='PostgreSQL-only refresh'
elif ! install_pinned; then
  failed_step='install'
fi

if [ -n "$failed_step" ]; then
  echo "The ${failed_step} failed (an Ubuntu mirror that does not answer is the usual cause); switching to independent and canonical Ubuntu mirrors and refreshing every list once."
  # Keep a record of the image's own list in the job log before it is replaced.
  if [ -f "$UBUNTU_MIRRORS" ]; then
    echo "Replacing the mirror list ${UBUNTU_MIRRORS}:"
    sed 's/^/  /' "$UBUNTU_MIRRORS" || true
  fi
  # The rewrite only helps sources that read the mirror list, so the log says whether any do. It is harmless
  # when none does: the refresh and install below are then simply one more try.
  mirror_sources="$(grep -rl 'mirror+file:' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null || true)"
  if [ -n "$mirror_sources" ]; then
    echo "Apt sources that read the mirror list:"
    printf '%s\n' "$mirror_sources" | sed 's/^/  /'
  else
    echo "No apt source reads the mirror list, so the rewrite changes nothing for apt; the refresh and install below are one more try."
  fi
  # Every entry uses https; Azure's mirror answers over it too.
  priority=0
  for mirror in "${FALLBACK_MIRRORS[@]}"; do
    priority=$((priority + 1))
    printf '%s\tpriority:%d\n' "$mirror" "$priority"
  done | sudo tee "$UBUNTU_MIRRORS" >/dev/null
  # A command stopped by the ceiling can leave dpkg half-way through a package; finish that work before the retry.
  sudo timeout --kill-after=10 "$APT_LIMIT_SECONDS" dpkg --configure -a || true
  { apt_get update && install_pinned; } || {
    echo "Could not install PostgreSQL 18 ${PG_BUILD}, not even from the independent and canonical Ubuntu mirrors." >&2
    exit 1
  }
fi
