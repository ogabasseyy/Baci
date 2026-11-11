-- Operator replay of PiggyVest webhook captures parked as needs_review (R5).
--
-- PiggyVest has no endpoint to request a webhook resend: once their own
-- retries run out, our durable capture is the only copy of an event. A
-- capture the drain parked for review (attempt budget spent, a processing
-- bug since fixed, ...) therefore needs an explicit way back into the queue.
--
-- This migration adds that way and nothing else:
--
-- * piggyvest_webhook_capture_operator: a NOLOGIN group role. The owner
--   provisions a personal operator login as its only member (runbook:
--   docs/piggyvest-webhook-capture-drain-runbook.md). It can EXECUTE the two
--   functions of schema piggyvest_capture_operator and nothing else here. It
--   holds no table privilege and is not service_role.
-- * piggyvest_capture_operator.list_review_captures: review metadata only
--   (never bodies, signatures or headers).
-- * piggyvest_capture_operator.requeue_review_capture: moves ONE
--   needs_review capture back to pending with a fresh attempt budget and
--   writes an append-only audit row (who = SESSION_USER, when, why, and the
--   state it left). It never processes anything itself: the regular drain
--   claims the row again and re-verifies the stored bytes and signature
--   against the current, overlap and replay-only archived keys exactly as it
--   does for every capture, so bytes no key vouches for are never processed.
--   Downstream ledgers dedupe on the provider keys, so replaying an event
--   that was already credited applies nothing a second time.
-- * public.piggyvest_webhook_capture_replay_audit: the append-only trail.
--   No API or operator role holds any privilege on it, and triggers refuse
--   UPDATE, DELETE and TRUNCATE. Only the table owner or a superuser could
--   disable those triggers; that is the usual limit of trigger-enforced
--   append-only tables.
--
-- Captured evidence is untouched (the immutability trigger still guards it).
-- A row can be requeued at most five times; more needs a code change, not
-- another click. Applying this migration changes no behaviour: nothing calls
-- the functions until the owner provisions an operator login.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_webhook_capture_operator'
  ) THEN
    CREATE ROLE piggyvest_webhook_capture_operator
      NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSIF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_webhook_capture_operator'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb
        OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_operator exists with unexpected attributes';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'piggyvest_webhook_capture_operator'
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_operator must not be a member of another role';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.piggyvest_webhook_capture_replay_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  capture_id uuid NOT NULL
    REFERENCES public.piggyvest_webhook_captures (id) ON DELETE RESTRICT,
  actor text NOT NULL
    CONSTRAINT piggyvest_webhook_capture_replay_audit_actor_check
    CHECK (char_length(actor) BETWEEN 1 AND 128),
  reason text NOT NULL
    CONSTRAINT piggyvest_webhook_capture_replay_audit_reason_check
    CHECK (char_length(reason) BETWEEN 10 AND 500),
  previous_state text NOT NULL
    CONSTRAINT piggyvest_webhook_capture_replay_audit_previous_state_check
    CHECK (previous_state = 'needs_review'),
  previous_attempts integer NOT NULL
    CONSTRAINT piggyvest_webhook_capture_replay_audit_previous_attempts_check
    CHECK (previous_attempts >= 0),
  previous_last_error text NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS piggyvest_webhook_capture_replay_audit_capture_idx
  ON public.piggyvest_webhook_capture_replay_audit (capture_id);

ALTER TABLE public.piggyvest_webhook_capture_replay_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS piggyvest_webhook_capture_replay_audit_deny_all
  ON public.piggyvest_webhook_capture_replay_audit;
CREATE POLICY piggyvest_webhook_capture_replay_audit_deny_all
  ON public.piggyvest_webhook_capture_replay_audit
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.piggyvest_webhook_capture_replay_audit
  FROM PUBLIC, anon, authenticated, service_role;
-- Default privileges in public would otherwise hand the identity sequence
-- to the API roles.
REVOKE ALL ON SEQUENCE public.piggyvest_webhook_capture_replay_audit_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.piggyvest_webhook_capture_replay_audit IS
  'Append-only record of operator requeues of needs_review PiggyVest webhook captures. Reachable only through piggyvest_capture_operator functions.';

CREATE OR REPLACE FUNCTION public.piggyvest_webhook_capture_replay_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'capture replay audit is append-only' USING ERRCODE = '42501';
END
$$;

REVOKE ALL ON FUNCTION public.piggyvest_webhook_capture_replay_audit_append_only()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS piggyvest_webhook_capture_replay_audit_append_only
  ON public.piggyvest_webhook_capture_replay_audit;
CREATE TRIGGER piggyvest_webhook_capture_replay_audit_append_only
  BEFORE UPDATE OR DELETE ON public.piggyvest_webhook_capture_replay_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.piggyvest_webhook_capture_replay_audit_append_only();

DROP TRIGGER IF EXISTS piggyvest_webhook_capture_replay_audit_no_truncate
  ON public.piggyvest_webhook_capture_replay_audit;
CREATE TRIGGER piggyvest_webhook_capture_replay_audit_no_truncate
  BEFORE TRUNCATE ON public.piggyvest_webhook_capture_replay_audit
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.piggyvest_webhook_capture_replay_audit_append_only();

CREATE SCHEMA IF NOT EXISTS piggyvest_capture_operator;
REVOKE ALL ON SCHEMA piggyvest_capture_operator
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_capture_operator TO piggyvest_webhook_capture_operator;

-- Review metadata, newest first. Never bodies, signatures or headers.
CREATE OR REPLACE FUNCTION piggyvest_capture_operator.list_review_captures(p_limit integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(r ORDER BY r."receivedAt" DESC, r."captureId"), '[]'::jsonb)
  FROM (
    SELECT c.id AS "captureId",
      c.event_type AS "eventType",
      c.provider_transaction_id AS "providerTransactionId",
      c.key_version AS "keyVersion",
      c.attempts,
      c.last_error AS "lastError",
      c.received_at AS "receivedAt",
      -- Last change to the row, which is the park time unless it was
      -- requeued and parked again since.
      c.updated_at AS "lastChangedAt",
      (SELECT pg_catalog.count(*)::integer
         FROM public.piggyvest_webhook_capture_replay_audit a
         WHERE a.capture_id = c.id) AS "operatorReplays"
    FROM public.piggyvest_webhook_captures c
    WHERE c.processing_state = 'needs_review'
    ORDER BY c.received_at DESC, c.id
    LIMIT least(greatest(COALESCE(p_limit, 50), 1), 200)
  ) AS r
$$;

-- Requeue one parked capture. Outcomes (jsonb {"outcome": ...}):
--   requeued              the row is pending again; auditId names the audit row
--   not_found             no capture has that id
--   not_in_review         the row is not needs_review (processingState says
--                         what it is); nothing changed, so a second call for
--                         the same row is a harmless no-op
--   replay_limit_reached  the row was already requeued five times
--   credit_dedupe_missing the row is a credit event (bank inflow or interest
--                         payout, or has no readable event type) and the credit
--                         ledgers do not yet dedupe on pvb_reference (a full,
--                         valid unique index on that column alone, as the
--                         UNIQUE constraints of PR #4199 create);
--                         replaying it could credit a partial credit twice
-- The session checks the operator tool makes, enforced again in the database
-- so a direct call from psql cannot skip them. Returns '' when the session
-- may requeue, otherwise why not. Internal: no role is granted EXECUTE; only
-- the SECURITY DEFINER function below (running as the owner) calls it.
CREATE OR REPLACE FUNCTION piggyvest_capture_operator.session_refusal()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN NOT login.rolcanlogin OR login.rolsuper OR login.rolbypassrls
        OR login.rolcreaterole OR login.rolcreatedb OR login.rolreplication
        THEN 'the session login carries an elevated attribute'
      WHEN NOT pg_catalog.pg_has_role(
          SESSION_USER, 'piggyvest_webhook_capture_operator', 'MEMBER')
        THEN 'the session login is not a member of piggyvest_webhook_capture_operator'
      WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
          WHERE r.rolname NOT IN (SESSION_USER, 'piggyvest_webhook_capture_operator')
            AND pg_catalog.pg_has_role(SESSION_USER, r.oid, 'MEMBER'))
        THEN 'the session login holds a role besides the operator role'
      WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
          CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
          JOIN pg_catalog.pg_roles r ON r.oid = g.grantee
          WHERE r.rolname IN ('piggyvest_webhook_capture_worker', 'piggyvest_webhook_intake')
            AND g.privilege_type = 'EXECUTE'
            AND pg_catalog.has_function_privilege(SESSION_USER, p.oid, 'EXECUTE'))
        THEN 'the session login can run capture pipeline functions'
      WHEN pg_catalog.has_table_privilege(SESSION_USER, 'public.piggyvest_webhook_captures',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_table_privilege(SESSION_USER,
          'public.piggyvest_webhook_capture_replay_audit',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        THEN 'the session login can reach the capture or audit tables directly'
      WHEN NOT (
          COALESCE((SELECT s.ssl FROM pg_catalog.pg_stat_ssl s
            WHERE s.pid = pg_catalog.pg_backend_pid()), false)
          OR pg_catalog.inet_client_addr() IS NULL
          OR pg_catalog.inet_client_addr() <<= '127.0.0.0/8'::inet
          OR pg_catalog.inet_client_addr() = '::1'::inet)
        THEN 'the session connection is not encrypted'
      ELSE ''
    END
    FROM pg_catalog.pg_roles login
    WHERE login.rolname = SESSION_USER), 'the session login is unknown')
$$;

REVOKE ALL ON FUNCTION piggyvest_capture_operator.session_refusal()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION piggyvest_capture_operator.requeue_review_capture(
  p_capture_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor text := SESSION_USER;
  v_reason text := pg_catalog.btrim(p_reason);
  v_row record;
  v_replays integer;
  v_replay_limit constant integer := 5;
  v_updated integer;
  v_audit_id bigint;
  v_refusal text;
BEGIN
  v_refusal := piggyvest_capture_operator.session_refusal();
  IF v_refusal <> '' THEN
    RAISE EXCEPTION 'operator session refused: %', v_refusal USING ERRCODE = '42501';
  END IF;
  IF p_capture_id IS NULL THEN
    RAISE EXCEPTION 'a capture id is required' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT c.id, c.processing_state, c.attempts, c.last_error, c.event_type
    INTO v_row
    FROM public.piggyvest_webhook_captures c
    WHERE c.id = p_capture_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_row.processing_state <> 'needs_review' THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'not_in_review', 'processingState', v_row.processing_state);
  END IF;

  -- Money safety is enforced here, not only in the runbook: a credit event
  -- replays only once both ledgers enforce pvb_reference uniqueness.
  IF (v_row.event_type IS NULL
      OR v_row.event_type IN ('bank-transfer.inflow.success', 'interest-payout.success'))
    AND NOT (
      EXISTS (SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = pg_catalog.to_regclass('public.piggyvest_inflow_credits')
          AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND a.attname = 'pvb_reference')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = pg_catalog.to_regclass('public.piggyvest_interest_payouts')
          AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND a.attname = 'pvb_reference'))
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'credit_dedupe_missing', 'eventType', v_row.event_type);
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_replays
    FROM public.piggyvest_webhook_capture_replay_audit a
    WHERE a.capture_id = p_capture_id;
  IF v_replays >= v_replay_limit THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'replay_limit_reached', 'operatorReplays', v_replays,
      'replayLimit', v_replay_limit);
  END IF;

  UPDATE public.piggyvest_webhook_captures c
  SET processing_state = 'pending',
      attempts = 0,
      config_deferrals = 0,
      next_attempt_at = NULL,
      processed_at = NULL,
      last_error = 'OPERATOR_REPLAY_REQUESTED',
      claim_token = NULL,
      lease_until = NULL,
      updated_at = clock_timestamp()
  WHERE c.id = p_capture_id
    AND c.processing_state = 'needs_review';
  -- The row lock makes this unreachable today; if the row did not move, write
  -- no audit and report no success (the whole call rolls back).
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'capture % was not requeued; retry', p_capture_id
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.piggyvest_webhook_capture_replay_audit (
    capture_id, actor, reason, previous_state, previous_attempts, previous_last_error)
  VALUES (p_capture_id, v_actor, v_reason, v_row.processing_state, v_row.attempts,
    v_row.last_error)
  RETURNING id INTO v_audit_id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'requeued',
    'auditId', v_audit_id,
    'previousAttempts', v_row.attempts,
    'previousLastError', v_row.last_error,
    'operatorReplays', v_replays + 1,
    'replayLimit', v_replay_limit);
END
$$;

REVOKE ALL ON FUNCTION piggyvest_capture_operator.list_review_captures(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_capture_operator.requeue_review_capture(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_capture_operator.list_review_captures(integer)
  TO piggyvest_webhook_capture_operator;
GRANT EXECUTE ON FUNCTION piggyvest_capture_operator.requeue_review_capture(uuid, text)
  TO piggyvest_webhook_capture_operator;
