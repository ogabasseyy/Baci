\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'supabase_admin'
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7686901100561231906' THEN
    RAISE EXCEPTION 'Receipt runtime storage target refused';
  END IF;
  IF to_regclass('public.piggyvest_staging_replay_quarantine') IS NULL THEN
    RAISE EXCEPTION 'Install replay storage first';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pvb_staging_replay_executor') THEN
    CREATE ROLE pvb_staging_replay_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('pvb_staging_replay_executor', 'pvb_staging_worker')
    AND (rolsuper OR rolcanlogin OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT FROM pg_auth_members WHERE
      member IN ('pvb_staging_replay_executor'::regrole, 'pvb_staging_worker'::regrole)
      OR roleid = 'pvb_staging_replay_executor'::regrole) THEN
    RAISE EXCEPTION 'Unsafe replay role attributes or memberships';
  END IF;
END
$guard$;

ALTER TABLE public.piggyvest_staging_receipts
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE public.piggyvest_staging_replay_quarantine
  DROP CONSTRAINT IF EXISTS piggyvest_staging_replay_quarantine_reason_check;
ALTER TABLE public.piggyvest_staging_replay_quarantine
  ADD CONSTRAINT piggyvest_staging_replay_quarantine_reason_check CHECK (reason IN (
    'unmapped', 'ambiguous', 'conflict', 'poison', 'unsupported', 'undecryptable', 'mapping-mismatch',
    'authentication-failed', 'customer-mismatch', 'digest-mismatch', 'event-id-mismatch', 'invalid-event',
    'invalid-json', 'invalid-receipt', 'unstable-event-id', 'unsupported-event', 'invalid-utf8'));
UPDATE public.piggyvest_staging_receipts
SET next_attempt_at = clock_timestamp() + interval '30 minutes'
WHERE status = 'quarantined' AND last_error = 'worker retryable' AND next_attempt_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_piggyvest_staging_receipts(p_limit integer, p_lease_seconds integer)
RETURNS TABLE (receipt_id uuid, payload_sha256 text, ciphertext text, nonce text,
  auth_tag text, key_version text, claim_token uuid, attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
    OR p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid claim bounds';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  WITH exhausted AS (
    SELECT candidate.id FROM public.piggyvest_staging_receipts AS candidate
    WHERE candidate.attempts >= 10
      AND ((candidate.status = 'quarantined' AND
        (candidate.last_error IS NULL OR candidate.last_error = 'worker retryable'))
        OR (candidate.status = 'processing' AND
          (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= clock_timestamp())))
    ORDER BY candidate.received_at, candidate.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.piggyvest_staging_receipts AS receipt
  SET status = 'dead_letter', claim_token = NULL, lease_expires_at = NULL,
    next_attempt_at = NULL, last_error = 'attempts exhausted'
  FROM exhausted WHERE receipt.id = exhausted.id;
  RETURN QUERY
  WITH eligible AS (
    SELECT candidate.id FROM public.piggyvest_staging_receipts AS candidate
    WHERE candidate.attempts < 10 AND (
      (candidate.status = 'quarantined'
        AND (candidate.last_error IS NULL OR candidate.last_error = 'worker retryable')
        AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= clock_timestamp()))
      OR (candidate.status = 'processing'
        AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= clock_timestamp())))
    ORDER BY candidate.received_at, candidate.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.piggyvest_staging_receipts AS receipt
  SET status = 'processing', claim_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    attempts = receipt.attempts + 1, next_attempt_at = NULL, last_error = NULL
  FROM eligible WHERE receipt.id = eligible.id
  RETURNING receipt.id, receipt.payload_sha256, receipt.ciphertext, receipt.nonce,
    receipt.auth_tag, receipt.key_version, receipt.claim_token, receipt.attempts;
END
$function$;

CREATE OR REPLACE FUNCTION public.resolve_piggyvest_staging_receipt(
  p_receipt_id uuid, p_claim_token uuid, p_status text, p_last_error text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE affected integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('processed', 'quarantined', 'dead_letter')
    OR (p_status = 'quarantined' AND p_last_error IS DISTINCT FROM 'worker retryable')
    OR (p_status <> 'quarantined' AND p_last_error IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid resolution';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  UPDATE public.piggyvest_staging_receipts
  SET status = CASE WHEN p_status = 'quarantined' AND attempts >= 10 THEN 'dead_letter' ELSE p_status END,
    next_attempt_at = CASE WHEN p_status = 'quarantined' AND attempts < 10
      THEN clock_timestamp() + make_interval(secs => least(86400, 1800 * (1 << least(attempts - 1, 6)))) ELSE NULL END,
    last_error = CASE WHEN p_status = 'quarantined' AND attempts >= 10 THEN 'attempts exhausted' ELSE p_last_error END,
    claim_token = NULL, lease_expires_at = NULL,
    processed_at = CASE WHEN p_status = 'processed' THEN clock_timestamp() ELSE processed_at END
  WHERE id = p_receipt_id AND claim_token = p_claim_token AND status = 'processing'
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.quarantine_piggyvest_staging_receipt(
  p_receipt_id uuid, p_claim_token uuid, p_event_id text, p_reason text, p_detail jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('unmapped', 'ambiguous', 'conflict', 'poison', 'unsupported',
    'undecryptable', 'mapping-mismatch', 'authentication-failed', 'customer-mismatch', 'digest-mismatch',
    'event-id-mismatch', 'invalid-event', 'invalid-json', 'invalid-receipt', 'unstable-event-id', 'unsupported-event', 'invalid-utf8')
    OR p_detail IS NOT NULL OR length(p_event_id) > 1024 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid quarantine';
  END IF;
  IF p_reason = 'unmapped' THEN
    RETURN public.resolve_piggyvest_staging_receipt(p_receipt_id, p_claim_token, 'quarantined', 'worker retryable');
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  PERFORM 1 FROM public.piggyvest_staging_receipts
  WHERE id = p_receipt_id AND claim_token = p_claim_token AND status = 'processing'
    AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.piggyvest_staging_replay_quarantine(receipt_id, event_id, reason, detail)
  VALUES (p_receipt_id, p_event_id, p_reason, NULL)
  ON CONFLICT (receipt_id) DO UPDATE SET reason = p_reason, event_id = p_event_id,
    attempts = public.piggyvest_staging_replay_quarantine.attempts + 1,
    detail = NULL, resolved_at = NULL, resolution = NULL;
  UPDATE public.piggyvest_staging_receipts
  SET status = 'quarantined', claim_token = NULL, lease_expires_at = NULL,
    next_attempt_at = NULL, last_error = p_reason WHERE id = p_receipt_id;
  RETURN true;
END
$function$;

DO $privileges$
DECLARE relation_name text; column_list text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['piggyvest_staging_receipts', 'piggyvest_staging_replay_quarantine'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM pvb_staging_worker, PUBLIC', relation_name);
    SELECT string_agg(quote_ident(attname), ',') INTO column_list FROM pg_attribute
    WHERE attrelid = format('public.%I', relation_name)::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM pvb_staging_worker, PUBLIC', column_list, relation_name);
  END LOOP;
END
$privileges$;
DROP POLICY IF EXISTS pvb_staging_worker_receipts ON public.piggyvest_staging_receipts;
DROP POLICY IF EXISTS pvb_staging_worker_quarantine ON public.piggyvest_staging_replay_quarantine;
GRANT USAGE ON SCHEMA public TO pvb_staging_replay_executor, pvb_staging_worker;
GRANT SELECT ON public.piggyvest_staging_receipts, public.piggyvest_staging_replay_quarantine TO pvb_staging_replay_executor;
GRANT UPDATE (status, claim_token, lease_expires_at, attempts, last_error, processed_at, next_attempt_at)
  ON public.piggyvest_staging_receipts TO pvb_staging_replay_executor;
GRANT INSERT (receipt_id, event_id, reason, detail), UPDATE (event_id, reason, attempts, detail, resolved_at, resolution)
  ON public.piggyvest_staging_replay_quarantine TO pvb_staging_replay_executor;
DROP POLICY IF EXISTS pvb_staging_executor_receipts ON public.piggyvest_staging_receipts;
DROP POLICY IF EXISTS pvb_staging_executor_quarantine ON public.piggyvest_staging_replay_quarantine;
CREATE POLICY pvb_staging_executor_receipts ON public.piggyvest_staging_receipts
  FOR ALL TO pvb_staging_replay_executor USING (true) WITH CHECK (true);
CREATE POLICY pvb_staging_executor_quarantine ON public.piggyvest_staging_replay_quarantine
  FOR ALL TO pvb_staging_replay_executor USING (true) WITH CHECK (true);
GRANT CREATE ON SCHEMA public TO pvb_staging_replay_executor;
ALTER FUNCTION public.claim_piggyvest_staging_receipts(integer, integer) OWNER TO pvb_staging_replay_executor;
ALTER FUNCTION public.resolve_piggyvest_staging_receipt(uuid, uuid, text, text) OWNER TO pvb_staging_replay_executor;
ALTER FUNCTION public.quarantine_piggyvest_staging_receipt(uuid, uuid, text, text, jsonb) OWNER TO pvb_staging_replay_executor;
REVOKE CREATE ON SCHEMA public FROM pvb_staging_replay_executor;
REVOKE ALL ON FUNCTION public.claim_piggyvest_staging_receipts(integer, integer),
  public.resolve_piggyvest_staging_receipt(uuid, uuid, text, text),
  public.quarantine_piggyvest_staging_receipt(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, pvb_staging_ingest;
GRANT EXECUTE ON FUNCTION public.claim_piggyvest_staging_receipts(integer, integer),
  public.resolve_piggyvest_staging_receipt(uuid, uuid, text, text),
  public.quarantine_piggyvest_staging_receipt(uuid, uuid, text, text, jsonb)
  TO pvb_staging_worker;
DO $audit$
BEGIN
  IF has_any_column_privilege('pvb_staging_worker', 'public.piggyvest_staging_receipts', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('pvb_staging_worker', 'public.piggyvest_staging_replay_quarantine', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR EXISTS (SELECT FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp%'
      AND has_schema_privilege('pvb_staging_replay_executor', oid, 'CREATE')) THEN
    RAISE EXCEPTION 'Replay privilege boundary refused';
  END IF;
  IF EXISTS (
    SELECT FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname !~ '^pg_'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND relation.oid NOT IN ('public.piggyvest_staging_receipts'::regclass,
        'public.piggyvest_staging_replay_quarantine'::regclass)
      AND (has_table_privilege('pvb_staging_replay_executor', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege('pvb_staging_replay_executor', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  ) OR EXISTS (
    SELECT FROM pg_proc AS routine JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND routine.prosecdef
      AND has_function_privilege('pvb_staging_replay_executor', routine.oid, 'EXECUTE')
      AND routine.oid NOT IN ('public.claim_piggyvest_staging_receipts(integer,integer)'::regprocedure,
        'public.resolve_piggyvest_staging_receipt(uuid,uuid,text,text)'::regprocedure,
        'public.quarantine_piggyvest_staging_receipt(uuid,uuid,text,text,jsonb)'::regprocedure)
  ) THEN
    RAISE EXCEPTION 'Executor reaches outside replay storage';
  END IF;
END
$audit$;
NOTIFY pgrst, 'reload schema';
COMMIT;
