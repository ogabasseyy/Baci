#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="baci-growth-hint-${RANDOM}-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
apply_fix=true
if [[ "${1:-}" == "--baseline" ]]; then apply_fix=false; fi
docker run --name "$container" -e POSTGRES_PASSWORD=test -v "$repo_root/supabase:/repo:ro" -d postgres:17-alpine >/dev/null
ready=false
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "PostgreSQL did not become ready" >&2; exit 1; fi
docker exec "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -v "apply_fix=$apply_fix" -f /repo/tests/storefront_growth_integration_hint.sql
