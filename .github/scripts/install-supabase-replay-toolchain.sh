#!/usr/bin/env bash
# Installs (GitHub-hosted runners) or verifies (self-hosted CI server) the pinned DB replay toolchain:
# PostgreSQL 18.6 client and server binaries plus the Supabase CLI.
#
# Keep the PostgreSQL release in lockstep with apps/web/tools/db/supabase-replay-contract.ts, which asserts
# the same psql version before any replay runs, and with the two pins below.
set -euo pipefail

: "${SUPABASE_CLI_VERSION:?}" "${SUPABASE_CLI_SHA256:?}" "${RUNNER_ENVIRONMENT:?}" "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}"

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
  sudo tar -xz -f "${SUPABASE_ARCHIVE}" -C /usr/local/bin supabase supabase-go
  sudo chmod 0755 /usr/local/bin/supabase /usr/local/bin/supabase-go
fi
test -x /usr/lib/postgresql/18/bin/initdb
test -x /usr/local/bin/supabase-go
test "$(supabase --version)" = "${SUPABASE_CLI_VERSION}"
PSQL_BIN="$(command -v psql)"
"$PSQL_BIN" --version | grep -Eq '^psql \(PostgreSQL\) 18\.6( \(.+\))?$'
echo "PSQL_BIN=$PSQL_BIN" >> "$GITHUB_ENV"
