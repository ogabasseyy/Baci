#!/usr/bin/env bash
set -euo pipefail

while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p')
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d /private/tmp/baci-prefunded-card-recovery.XXXXXX)"

cleanup() {
  if [[ -f "$test_root/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT INT TERM
mkdir -m 700 "$test_root/socket"
"$postgres_bin/initdb" -D "$test_root/data" -A trust -U harness_admin --no-locale --encoding=UTF8 >/dev/null
"$postgres_bin/pg_ctl" -D "$test_root/data" -o "-k '$test_root/socket' -h '' -p 55456" -l "$test_root/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -w -v ON_ERROR_STOP=1 -h "$test_root/socket" -p 55456 -U harness_admin -d postgres)

system_id="$("${psql[@]}" -Atc 'SELECT system_identifier FROM pg_control_system()')"
"${psql[@]}" -v system_id="$system_id" <<'SQL' >/dev/null
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE prefunded_treasury_operator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE prefunded_authorizer LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE SCHEMA prefunded_card;
CREATE TABLE prefunded_card.treasury_bindings(
  id uuid PRIMARY KEY, integration_id uuid NOT NULL, merchant_id uuid NOT NULL,
  expected_business_id text NOT NULL, authorized_login name NOT NULL, currency text NOT NULL
);
CREATE TABLE prefunded_card.checkout_intents(
  id uuid PRIMARY KEY, deployment text NOT NULL, integration_id uuid NOT NULL, merchant_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL, business_id text NOT NULL, system_identifier text NOT NULL,
  expires_at timestamptz NOT NULL, database_name name NOT NULL, authorized_login name NOT NULL,
  phase text NOT NULL, created_at timestamptz NOT NULL
);
CREATE FUNCTION prefunded_card.checkout_require_executor(p_login name) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF session_user IS DISTINCT FROM p_login THEN RAISE EXCEPTION 'executor denied' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION prefunded_card.checkout_validate_scope(p_scope jsonb,p_mutation boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_scope IS NULL OR jsonb_typeof(p_scope)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_scope))<>7
    OR NOT p_scope ?& ARRAY['deployment','integrationId','merchantId','treasuryBindingId','businessId','systemIdentifier','expiresAt']
    OR p_scope->>'deployment' IS DISTINCT FROM 'staging'
    OR p_scope->>'systemIdentifier' IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_scope->>'expiresAt' IS DISTINCT FROM '2026-09-29T15:59:10Z' THEN
    RAISE EXCEPTION 'scope denied' USING ERRCODE='42501';
  END IF;
END $$;
CREATE FUNCTION prefunded_card.checkout_utc_iso(p_value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT to_char(p_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION prefunded_card.checkout_intent_json(intent prefunded_card.checkout_intents) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=prefunded_card,pg_catalog AS $$
  SELECT jsonb_build_object('intentId',intent.id,'reference','pvb-first-' || intent.id::text)
$$;
INSERT INTO prefunded_card.treasury_bindings VALUES
  ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','recovery-business','prefunded_treasury_operator','NGN');
INSERT INTO prefunded_card.checkout_intents VALUES
  ('80000000-0000-4000-8000-000000000001','staging','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','recovery-business',:'system_id','2026-09-29T15:59:10Z',current_database(),'prefunded_treasury_operator','initializing','2026-09-26T12:00:00Z'),
  ('80000000-0000-4000-8000-000000000002','staging','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','recovery-business',:'system_id','2026-09-29T15:59:10Z',current_database(),'prefunded_treasury_operator','ready','2026-09-26T12:01:00Z'),
  ('80000000-0000-4000-8000-000000000003','staging','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','recovery-business',:'system_id','2026-09-29T15:59:10Z',current_database(),'prefunded_treasury_operator','pending','2026-09-26T12:02:00Z'),
  ('80000000-0000-4000-8000-000000000004','staging','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','recovery-business',:'system_id','2026-09-29T15:59:10Z',current_database(),'prefunded_treasury_operator','completed','2026-09-26T12:03:00Z');
CREATE SCHEMA prefunded_first_card_recovery_test;
CREATE FUNCTION prefunded_first_card_recovery_test.scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('deployment','staging','integrationId','40000000-0000-4000-8000-000000000001','merchantId','10000000-0000-4000-8000-000000000001','treasuryBindingId','50000000-0000-4000-8000-000000000001','businessId','recovery-business','systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'expiresAt','2026-09-29T15:59:10Z')
$$;
CREATE FUNCTION prefunded_first_card_recovery_test.cursor(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=prefunded_first_card_recovery_test,prefunded_card,pg_catalog AS $$
  SELECT jsonb_build_object('createdAt',prefunded_card.checkout_utc_iso(created_at),'intentId',id) FROM prefunded_card.checkout_intents WHERE id=p_id
$$;
CREATE FUNCTION prefunded_first_card_recovery_test.candidate(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=prefunded_first_card_recovery_test,prefunded_card,pg_catalog AS $$
  SELECT jsonb_build_object('cursor',prefunded_first_card_recovery_test.cursor(id),'intent',prefunded_card.checkout_intent_json(checkout_intents)) FROM prefunded_card.checkout_intents WHERE id=p_id
$$;
GRANT USAGE ON SCHEMA prefunded_card TO prefunded_authorizer,prefunded_treasury_operator,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA prefunded_first_card_recovery_test TO prefunded_authorizer;
SQL

"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/checkout-recovery.sql" >/dev/null
if "${psql[@]}" -c "SET SESSION AUTHORIZATION prefunded_treasury_operator; SELECT prefunded_card.checkout_recovery_candidates('{}'::jsonb,NULL,1)" >/dev/null 2>&1; then
  printf 'non-authorizer executed first-card recovery reader\n' >&2
  exit 1
fi
"${psql[@]}" -f "$worktree/tools/staging/prefunded-card/checkout-recovery.test.sql"
printf 'PASS disposable first-card checkout recovery SQL tests\n'
