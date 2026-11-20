#!/usr/bin/env bash
set -euo pipefail

# Step 2 Real Cloud E2E Rehearsal:
#   Cloudflare WEUR DO Rooms -> Real Cloudflare Queue -> Real Temporary Supabase Branch (XL)
#   -> Postgres scoring & Winner Award -> Automatic trap-guarded branch deletion.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PROTO_DIR}/../.." && pwd)"
WRANGLER="/Users/mac/Baci-app/node_modules/.bin/wrangler"
PROJECT_REF="${SUPABASE_PROJECT_REF:-aivqthbxdshhltbwipbr}"
BRANCH_NAME="quiz-step2-e2e-$(date +%Y%m%d-%H%M%S)"
CREATED_BRANCH=0
UPLOADED_DB_SECRETS=0
PLAYER_COUNT="${PLAYER_COUNT:-1000}"
ROOM_COUNT="${ROOM_COUNT:-4}"

export NODE_OPTIONS="--dns-result-order=ipv4first"

cleanup() {
  local exit_code=$?
  set +e
  if [[ "${UPLOADED_DB_SECRETS}" -eq 1 ]]; then
    echo "[cleanup] Removing temporary branch DB secrets from Worker..."
    (cd "${PROTO_DIR}" && \
      "${WRANGLER}" secret delete SUPABASE_URL --force >/dev/null 2>&1 || true; \
      "${WRANGLER}" secret delete SUPABASE_ANON_KEY --force >/dev/null 2>&1 || true; \
      "${WRANGLER}" secret delete QUIZ_BATCH_WORKER_JWT --force >/dev/null 2>&1 || true)
  fi
  if [[ "${CREATED_BRANCH}" -eq 1 ]]; then
    echo "[cleanup] Deleting temporary Supabase branch '${BRANCH_NAME}'..."
    supabase branches delete "${BRANCH_NAME}" --project-ref "${PROJECT_REF}" --yes
  fi
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

if [[ "${SKIP_DEPLOY:-0}" != "1" ]]; then
  echo "[0/5] Deploying Worker with Queue producer/consumer & seal-room endpoint..."
  (cd "${PROTO_DIR}" && "${WRANGLER}" deploy)
fi

echo "[1/5] Creating temporary Supabase preview branch '${BRANCH_NAME}' (eu-west-1, medium)..."
supabase branches create "${BRANCH_NAME}" \
  --project-ref "${PROJECT_REF}" \
  --region eu-west-1 \
  --size medium \
  --yes
CREATED_BRANCH=1

echo "[2/5] Waiting for branch '${BRANCH_NAME}' to finish provisioning (ACTIVE_HEALTHY & migrations done)..."
for i in $(seq 1 90); do
  LIST_JSON="$(supabase branches list --project-ref "${PROJECT_REF}" -o json 2>/dev/null || echo '{}')"
  B_STATUS="$(node -e "const d=JSON.parse(process.argv[1]||'{}'); const arr=Array.isArray(d)?d:(d.branches||[]); const b=arr.find(x=>x.name===process.argv[2]); console.log((b?.preview_project_status||'')+':'+(b?.status||''));" "${LIST_JSON}" "${BRANCH_NAME}")"
  echo "  poll ${i}: ${B_STATUS}"
  if [[ "${B_STATUS}" == ACTIVE_HEALTHY:* && "${B_STATUS}" != *:CREATING_PROJECT && "${B_STATUS}" != *:RUNNING_MIGRATIONS ]]; then
    break
  fi
  sleep 5
done

BRANCH_JSON="$(supabase branches get "${BRANCH_NAME}" --project-ref "${PROJECT_REF}" -o json 2>/dev/null || echo '{}')"
BRANCH_DB_URL="$(node -e "const d=JSON.parse(process.argv[1]||'{}'); const u=d.POSTGRES_URL || d.POSTGRES_URL_NON_POOLING || ''; console.log(u.replace(':6543/', ':5432/'));" "${BRANCH_JSON}")"
BRANCH_DB_URL_RAW="$(node -e "const d=JSON.parse(process.argv[1]||'{}'); console.log(d.POSTGRES_URL || d.POSTGRES_URL_NON_POOLING || '');" "${BRANCH_JSON}")"
BRANCH_API_URL="$(node -e "const d=JSON.parse(process.argv[1]||'{}'); console.log(d.SUPABASE_URL || '');" "${BRANCH_JSON}")"
BRANCH_JWT_SECRET="$(node -e "const d=JSON.parse(process.argv[1]||'{}'); console.log(d.SUPABASE_JWT_SECRET || '');" "${BRANCH_JSON}")"
BRANCH_ANON_KEY="$(node -e "const d=JSON.parse(process.argv[1]||'{}'); console.log(d.SUPABASE_ANON_KEY || '');" "${BRANCH_JSON}")"

if ! /opt/homebrew/bin/psql "${BRANCH_DB_URL}" -X -q -t -A -c "SELECT 1" >/dev/null 2>&1; then
  BRANCH_DB_URL="${BRANCH_DB_URL_RAW}"
fi

if [[ -z "${BRANCH_DB_URL}" || -z "${BRANCH_API_URL}" || -z "${BRANCH_JWT_SECRET}" || -z "${BRANCH_ANON_KEY}" ]]; then
  echo "ERROR: Missing branch credentials. Available keys in BRANCH_JSON:" >&2
  node -e "console.error(Object.keys(JSON.parse(process.argv[1]||'{}')))" "${BRANCH_JSON}"
  exit 1
fi

HAS_QUIZ_EVENTS="$(/opt/homebrew/bin/psql "${BRANCH_DB_URL}" -X -q -t -A -c "SELECT CASE WHEN to_regclass('public.quiz_events') IS NOT NULL THEN 'yes' ELSE 'no' END")"
echo "[3/5] Applying Stage 1 SQL migration (base public.quiz_events present: ${HAS_QUIZ_EVENTS})..."
apply_schema() {
  if [[ "${HAS_QUIZ_EVENTS}" == "yes" ]]; then
    {
      cat "${REPO_ROOT}/supabase/migrations/20261118170000_quiz_stage1_edge_prototype_v2.sql"
      echo ""
      echo "NOTIFY pgrst, 'reload schema';"
    } | /opt/homebrew/bin/psql "${BRANCH_DB_URL}" -X -v ON_ERROR_STOP=1 >/dev/null
  else
    (
      cd "${PROTO_DIR}/sql-bench"
      {
        echo "\\set ON_ERROR_STOP on"
        echo "CREATE SCHEMA IF NOT EXISTS private;"
        tail -n +84 "${PROTO_DIR}/sql-bench/bootstrap-local-pg.sql"
        echo "NOTIFY pgrst, 'reload schema';"
      } | /opt/homebrew/bin/psql "${BRANCH_DB_URL}" -X -v ON_ERROR_STOP=1 >/dev/null
    )
  fi
}

sleep 15
if ! apply_schema; then
  echo "  retrying schema apply after 15s (in case of post-boot compute resize)..."
  sleep 15
  HAS_QUIZ_EVENTS="$(/opt/homebrew/bin/psql "${BRANCH_DB_URL}" -X -q -t -A -c "SELECT CASE WHEN to_regclass('public.quiz_events') IS NOT NULL THEN 'yes' ELSE 'no' END")"
  apply_schema
fi
sleep 3

echo "[4/5] Minting HS256 quiz_edge_batch_worker JWT & binding temporary branch to Worker..."
WORKER_JWT="$(JWT_SECRET="${BRANCH_JWT_SECRET}" node -e '
  const crypto = require("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ role: "quiz_edge_batch_worker", iss: "supabase", iat: now, exp: now + 3600 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  process.stdout.write(`${h}.${p}.${sig}`);
')"

(cd "${PROTO_DIR}" && \
  printf '%s' "${BRANCH_API_URL}" | "${WRANGLER}" secret put SUPABASE_URL && \
  printf '%s' "${BRANCH_ANON_KEY}" | "${WRANGLER}" secret put SUPABASE_ANON_KEY && \
  printf '%s' "${WORKER_JWT}" | "${WRANGLER}" secret put QUIZ_BATCH_WORKER_JWT)
UPLOADED_DB_SECRETS=1

echo "[5/5] Running ${PLAYER_COUNT}-player end-to-end cloud test (DO Rooms -> CF Queue -> Supabase)..."
OUT_FILE="${PROTO_DIR}/bench/reports/live-step2-cloud-queue-supabase-e2e.json"
mkdir -p "$(dirname "${OUT_FILE}")"
BRANCH_DB_URL="${BRANCH_DB_URL}" \
PLAYER_COUNT="${PLAYER_COUNT}" \
ROOM_COUNT="${ROOM_COUNT}" \
CONCURRENCY=150 \
OUT_FILE="${OUT_FILE}" \
node "${PROTO_DIR}/bench/run-step2-cloud-e2e.mjs"
