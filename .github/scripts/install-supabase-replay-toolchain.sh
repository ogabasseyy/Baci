#!/usr/bin/env bash
# Installs (GitHub-hosted runners) or verifies (self-hosted CI server) the pinned DB replay toolchain:
# PostgreSQL 18.6 client and server binaries plus the Supabase CLI.
#
# Keep the PostgreSQL release in lockstep with apps/web/tools/db/supabase-replay-contract.ts, which asserts
# the same psql version before any replay runs, and with the two pins below.
set -euo pipefail

# RUNNER_ENVIRONMENT is a default variable the runner sets for every job ("github-hosted" or "self-hosted", see
# GitHub's "Default environment variables" reference), so the step needs no `env:` entry for it, and `env:` could not
# override it anyway. The version and checksum come from the step's `env:`.
: "${SUPABASE_CLI_VERSION:?}" "${SUPABASE_CLI_SHA256:?}" "${RUNNER_ENVIRONMENT:?}" "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}" "${GITHUB_PATH:?}"

# Every Supabase CLI release lives in its own folder instead of a shared bin directory, so a new release is
# installed beside the one a server already has and open pull requests that still pin the earlier release keep
# working. CLI 3.x is one executable, so the folder holds just that.
SUPABASE_CLI_DIR="/opt/supabase-cli/${SUPABASE_CLI_VERSION}"

# GitHub-hosted runners start empty and may use administrator rights. The self-hosted CI server
# (Ubuntu 26.04, runner user without administrator rights) has the same pinned toolchain
# pre-installed (PostgreSQL 18.6 and the Supabase CLI), so only the checks below run there.
if [ "$RUNNER_ENVIRONMENT" = 'github-hosted' ]; then
  sudo install -d /usr/share/postgresql-common/pgdg
  curl --fail --silent --show-error --location \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y postgresql-18=18.6-1.pgdg24.04+2 postgresql-client-18=18.6-1.pgdg24.04+2
  SUPABASE_ARCHIVE="${RUNNER_TEMP}/supabase_linux_amd64.tar.gz"
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_amd64.tar.gz" \
    --output "${SUPABASE_ARCHIVE}"
  echo "${SUPABASE_CLI_SHA256}  ${SUPABASE_ARCHIVE}" | sha256sum --check
  sudo install -d "${SUPABASE_CLI_DIR}"
  sudo tar -xz --no-same-owner -f "${SUPABASE_ARCHIVE}" -C "${SUPABASE_CLI_DIR}"
  sudo chmod 0755 "${SUPABASE_CLI_DIR}/supabase"
fi
# The pinned CLI goes first on PATH for the checks below (this process) and for every later step of the job,
# on both runner kinds, so a different release elsewhere on the machine is never picked up by mistake.
export PATH="${SUPABASE_CLI_DIR}:${PATH}"
echo "${SUPABASE_CLI_DIR}" >> "$GITHUB_PATH"
# On a self-hosted server the toolchain is provisioned outside this repository; say what is there so a
# drifted server (for example stale 18.3 binaries) is obvious from the log instead of an opaque failure.
found_server="$(/usr/lib/postgresql/18/bin/postgres --version 2>&1 | head -n 1 | cut -c1-160 || true)"
found_cli="$(supabase --version 2>&1 | head -n 1 | cut -c1-160 || true)"
echo "Replay toolchain on ${RUNNER_NAME:-this runner}: PostgreSQL 18 -> ${found_server:-missing}; Supabase CLI -> ${found_cli:-missing} (expected 18.6 and ${SUPABASE_CLI_VERSION})"
# The replay and SQL suites start their own servers, so the server programs must exist and be the pinned
# release too: a runner can have a current psql next to an older server.
test -x /usr/lib/postgresql/18/bin/initdb
test -x /usr/lib/postgresql/18/bin/pg_ctl
test -x /usr/lib/postgresql/18/bin/postgres
test -x /usr/lib/postgresql/18/bin/pg_isready
/usr/lib/postgresql/18/bin/postgres --version | grep -Eq '^postgres \(PostgreSQL\) 18\.6( \(.+\))?$'
test -x "${SUPABASE_CLI_DIR}/supabase"
test "$(supabase --version)" = "${SUPABASE_CLI_VERSION}"
# Pin the lookup to the PostgreSQL 18 tree: with PostgreSQL 16 installed as well, the default
# `psql` wrapper could resolve to another major, and the replay must run on the asserted binary.
PSQL_BIN=/usr/lib/postgresql/18/bin/psql
test -x "$PSQL_BIN"
"$PSQL_BIN" --version | grep -Eq '^psql \(PostgreSQL\) 18\.6( \(.+\))?$'
echo "PSQL_BIN=$PSQL_BIN" >> "$GITHUB_ENV"
