#!/usr/bin/env bash
set -euo pipefail

# Turnkey 9:00 AM 3-Round Demo Runner (run from host terminal with explicit approval).
# Provisions a temporary 1-hour isolated Supabase branch with trap-guarded deletion,
# deploys the quiz Worker, executes Rounds 1-3, and exports /demo/report telemetry.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PROTO_DIR}/../.." && pwd)"
BRANCH_NAME="quiz-9am-demo-$(date +%Y%m%d-%H%M%S)"
CREATED_BRANCH=0
REPORT_DIR="${PROTO_DIR}/bench/reports"
mkdir -p "${REPORT_DIR}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Missing required CLI '$1'." >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: Required env var '$name' is unset." >&2
    exit 1
  fi
}

cleanup() {
  local exit_code=$?
  if [[ "${CREATED_BRANCH}" -eq 1 && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
    echo "[cleanup] Deleting temporary Supabase branch '${BRANCH_NAME}'..."
    supabase branches delete "${BRANCH_NAME}" \
      --project-ref "${SUPABASE_PROJECT_REF}" --yes >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

for cmd in supabase wrangler k6 curl node; do
  require_cmd "${cmd}"
done

for var in SUPABASE_PROJECT_REF QUIZ_TICKET_SECRET QUIZ_JWT_SECRET QUIZ_INTERNAL_COORDINATOR_SECRET QUIZ_BATCH_WORKER_JWT QUIZ_DEMO_INVITE_CODE; do
  require_env "${var}"
done

echo "[1/6] Creating isolated 1-hour Supabase preview branch '${BRANCH_NAME}'..."
supabase branches create "${BRANCH_NAME}" --project-ref "${SUPABASE_PROJECT_REF}"
CREATED_BRANCH=1

BRANCH_META_JSON="$(supabase branches get "${BRANCH_NAME}" --project-ref "${SUPABASE_PROJECT_REF}" -o json)"
BRANCH_DB_URL="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.db_url || d.postgres_url || '');" "${BRANCH_META_JSON}")"
BRANCH_API_URL="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.api_url || d.supabase_url || '');" "${BRANCH_META_JSON}")"
if [[ -z "${BRANCH_DB_URL}" || -z "${BRANCH_API_URL}" ]]; then
  echo "ERROR: Could not parse branch DB/API URLs from Supabase CLI output." >&2
  exit 1
fi

echo "[2/6] Pushing schema migrations to temporary branch..."
(cd "${REPO_ROOT}" && supabase db push --db-url "${BRANCH_DB_URL}")

echo "[3/6] Uploading Worker secrets and deploying quiz prototype..."
cd "${PROTO_DIR}"
printf '%s' "${QUIZ_TICKET_SECRET}" | wrangler secret put QUIZ_TICKET_SECRET
printf '%s' "${QUIZ_JWT_SECRET}" | wrangler secret put QUIZ_JWT_SECRET
printf '%s' "${QUIZ_INTERNAL_COORDINATOR_SECRET}" | wrangler secret put QUIZ_INTERNAL_COORDINATOR_SECRET
printf '%s' "${QUIZ_BATCH_WORKER_JWT}" | wrangler secret put QUIZ_BATCH_WORKER_JWT
printf '%s' "${QUIZ_DEMO_INVITE_CODE}" | wrangler secret put QUIZ_DEMO_INVITE_CODE
printf '%s' "${BRANCH_API_URL}" | wrangler secret put SUPABASE_URL
DEPLOY_OUT="$(wrangler deploy)"
echo "${DEPLOY_OUT}"

WORKER_URL="${WORKER_URL:-$(printf '%s\n' "${DEPLOY_OUT}" | grep -Eo 'https://[^ ]+workers\.dev' | head -n 1)}"
if [[ -z "${WORKER_URL}" ]]; then
  echo "ERROR: Set WORKER_URL explicitly or verify wrangler deploy output." >&2
  exit 1
fi

setup_round() {
  local round_num="$1"
  local event_id="demo-round-${round_num}"
  curl -fsS -X POST "${WORKER_URL}/api/demo/admin/setup-round" \
    -H "Authorization: Bearer ${QUIZ_INTERNAL_COORDINATOR_SECRET}" \
    -H "Content-Type: application/json" \
    -d "{\"round\":${round_num},\"eventId\":\"${event_id}\"}" >/dev/null
  echo "${event_id}"
}

ENCODED_INVITE_CODE="$(node -e "process.stdout.write(encodeURIComponent(process.argv[1] || ''))" "${QUIZ_DEMO_INVITE_CODE}")"

echo ""
echo "=== ROUND 1 (10 Human Testers Baseline) ==="
R1_EVENT="$(setup_round 1)"
echo "Share URL with 10 human phones: ${WORKER_URL}/demo?eventId=${R1_EVENT}&code=${ENCODED_INVITE_CODE}"
read -r -p "Press ENTER after the 10 testers finish Round 1..."

echo ""
echo "=== ROUND 2 (10 Humans + 490 k6 Bots in room-0000 = 500/room) ==="
R2_EVENT="$(setup_round 2)"
echo "Share URL with 10 human phones: ${WORKER_URL}/demo?eventId=${R2_EVENT}&code=${ENCODED_INVITE_CODE}"
read -r -p "Press ENTER when testers are in lobby to launch 490 k6 bots..."
BASE_URL="${WORKER_URL}" ROUND=2 EVENT_ID="${R2_EVENT}" DEMO_INVITE_CODE="${QUIZ_DEMO_INVITE_CODE}" k6 run "${PROTO_DIR}/bench/k6-9am-demo-rounds.js"

echo ""
echo "=== ROUND 3 (10 Humans + 4,990 k6 Bots across 13 rooms w/ chaos) ==="
R3_EVENT="$(setup_round 3)"
echo "Share URL with 10 human phones: ${WORKER_URL}/demo?eventId=${R3_EVENT}&code=${ENCODED_INVITE_CODE}"
read -r -p "Press ENTER when testers are in lobby to launch 4,990 k6 bots..."
BASE_URL="${WORKER_URL}" ROUND=3 EVENT_ID="${R3_EVENT}" DEMO_INVITE_CODE="${QUIZ_DEMO_INVITE_CODE}" k6 run "${PROTO_DIR}/bench/k6-9am-demo-rounds.js"

REPORT_OUT="${REPORT_DIR}/demo-9am-report-$(date +%Y%m%d-%H%M%S).json"
curl -fsS "${WORKER_URL}/demo/report?format=json" -o "${REPORT_OUT}"
echo "[6/6] Exported carrier telemetry report to ${REPORT_OUT}"
