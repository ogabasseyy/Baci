-- Contract test: durable PiggyVest webhook capture (R5).
--
-- Proves, against live PostgreSQL:
--   * effective privileges (table: no direct access for anyone but the
--     owner; functions: service_role only), RLS enabled with deny-all;
--   * byte-exact capture, dedupe on (event key, body digest), no partial
--     row when a command is rejected;
--   * claim/lease/resolve lifecycle and immutable evidence.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_webhook_durable_capture.sql

BEGIN;

CREATE FUNCTION pg_temp.pv_cmd(
  p_body bytea,
  p_event_id text,
  p_event_type text,
  p_txn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'rawHex', encode(p_body, 'hex'),
    'bodyDigest', encode(sha256(p_body), 'hex'),
    'signature', repeat('ab', 64),
    'eventId', p_event_id,
    'eventType', p_event_type,
    'providerTransactionId', p_txn,
    'headers', jsonb_build_object('content-type', 'application/json'),
    'keyVersion', 'k-0123456789abcdef',
    'keyFamilies', jsonb_build_array('legacy'),
    'keyStatus', 'current'
  )
$$;

CREATE FUNCTION pg_temp.pv_count() RETURNS bigint
LANGUAGE sql
AS $$ SELECT count(*) FROM public.piggyvest_webhook_captures $$;

-- The ordered parts share this transaction and session (psql \ir, relative to
-- this file); they are not wired into CI on their own.

\ir piggyvest_webhook_durable_capture_contract.inc.sql

\ir piggyvest_webhook_durable_capture_validation.inc.sql

\ir piggyvest_webhook_durable_capture_claim.inc.sql

\ir piggyvest_webhook_durable_capture_roles.inc.sql

ROLLBACK;
