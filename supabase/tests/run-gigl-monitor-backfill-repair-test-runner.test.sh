#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/supabase/tests/run-gigl-monitor-backfill-repair-test.sh"

log_state=temp
readiness_attempts=0
docker() {
  if [[ "$1" == logs ]]; then
    if [[ "$log_state" == final ]]; then
      echo 'PostgreSQL init process complete; ready for start up.'
    else
      echo 'database system is ready to accept connections'
    fi
    return 0
  fi
  if [[ "$1" == exec ]]; then
    if [[ " $* " != *' psql '* || " $* " != *' -h 127.0.0.1 '* ]]; then
      echo 'readiness probe must use PostgreSQL over TCP' >&2
      return 3
    fi
    readiness_attempts=$((readiness_attempts + 1))
    if (( readiness_attempts == 1 )); then return 2; fi
    return 0
  fi
  return 1
}
sleep() { :; }

if wait_for_postgres_final_readiness test-container 2 2>/dev/null; then
  echo 'temporary initialization server was accepted as final' >&2
  exit 1
fi
if (( readiness_attempts != 0 )); then
  echo 'readiness was probed before initialization completed' >&2
  exit 1
fi

log_state=final
if ! wait_for_postgres_final_readiness test-container 2; then
  echo 'final PostgreSQL server was not accepted after retry' >&2
  exit 1
fi
if (( readiness_attempts != 2 )); then
  echo "expected two final readiness probes, got $readiness_attempts" >&2
  exit 1
fi

echo 'GIGL monitor PostgreSQL readiness regression test passed'
