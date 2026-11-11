#!/usr/bin/env bash
# Installs (GitHub-hosted runners) or verifies (self-hosted CI server) the pinned DB replay toolchain:
# PostgreSQL 18.6 client and server binaries plus the Supabase CLI.
#
# The hosted PostgreSQL install (repository, key check and the exact pinned build) is the shared
# install-postgresql-hosted.sh, the one place that pins the release. Keep the psql check below and
# apps/web/tools/db/supabase-replay-contract.ts, which asserts the same psql version before any replay
# runs, on that same release.
set -euo pipefail

# RUNNER_ENVIRONMENT is a default variable the runner sets for every job ("github-hosted" or "self-hosted", see
# GitHub's "Default environment variables" reference), so the step needs no `env:` entry for it, and `env:` could not
# override it anyway. The version and checksum come from the step's `env:`.
: "${SUPABASE_CLI_VERSION:?}" "${SUPABASE_CLI_SHA256:?}" "${RUNNER_ENVIRONMENT:?}" "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}"

# GitHub-hosted runners start empty and may use administrator rights. The self-hosted CI server
# (Ubuntu 26.04, runner user without administrator rights) has the same pinned toolchain
# pre-installed (PostgreSQL 18.6 and the Supabase CLI), so only the checks below run there.
if [ "$RUNNER_ENVIRONMENT" = 'github-hosted' ]; then
  bash .github/scripts/install-postgresql-hosted.sh
  SUPABASE_ARCHIVE="${RUNNER_TEMP}/supabase_linux_amd64.tar.gz"
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_amd64.tar.gz" \
    --output "${SUPABASE_ARCHIVE}"
  echo "${SUPABASE_CLI_SHA256}  ${SUPABASE_ARCHIVE}" | sha256sum --check
  sudo tar -xz -f "${SUPABASE_ARCHIVE}" -C /usr/local/bin supabase supabase-go
  sudo chmod 0755 /usr/local/bin/supabase /usr/local/bin/supabase-go
fi
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
test -x /usr/local/bin/supabase-go
test "$(supabase --version)" = "${SUPABASE_CLI_VERSION}"
# Pin the lookup to the PostgreSQL 18 tree: with PostgreSQL 16 installed as well, the default
# `psql` wrapper could resolve to another major, and the replay must run on the asserted binary.
PSQL_BIN=/usr/lib/postgresql/18/bin/psql
test -x "$PSQL_BIN"
"$PSQL_BIN" --version | grep -Eq '^psql \(PostgreSQL\) 18\.6( \(.+\))?$'
echo "PSQL_BIN=$PSQL_BIN" >> "$GITHUB_ENV"
