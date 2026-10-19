\set ON_ERROR_STOP on
\if :{?expected_system_identifier}
\else
DO $missing_identifier$
BEGIN
  RAISE EXCEPTION 'Required psql variable expected_system_identifier is absent';
END
$missing_identifier$;
\endif
-- Replay lifecycle for the isolated PiggyVest staging receipt store.
--
-- Extends public.piggyvest_staging_receipts (created by ingest-storage.sql)
-- with leased claims, bounded retries, dead-lettering and fenced,
-- atomic quarantine. All worker access is through the three RPCs below;
-- the worker role holds no direct table privileges. Encrypted receipts
-- are never decrypted here: decryption happens in the worker process
-- after claim, authenticated by AAD and digest.
--
-- Apply ONLY to the isolated staging database, as superuser
-- supabase_admin, with -v expected_system_identifier=<pg_control id>:
--   psql $ISOLATED_DB_URL -v ON_ERROR_STOP=1 \
--     -v expected_system_identifier=$(psql $ISOLATED_DB_URL -tAc \
--       'SELECT system_identifier FROM pg_control_system()') \
--     -f apps/web/tools/piggyvest-staging/replay-storage.sql
-- Never apply to the application database.
BEGIN;
SET LOCAL pvb_staging.expected_system_identifier = :'expected_system_identifier';

DO $guard$
BEGIN
  IF current_user <> 'supabase_admin'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Apply staging replay storage as superuser supabase_admin';
  END IF;
  IF current_setting('pvb_staging.expected_system_identifier') !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION 'Invalid expected_system_identifier';
  END IF;
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
    <> current_setting('pvb_staging.expected_system_identifier') THEN
    RAISE EXCEPTION 'Refusing database system identifier mismatch';
  END IF;
  IF to_regclass('public.piggyvest_staging_receipts') IS NULL THEN
    RAISE EXCEPTION 'ingest-storage.sql must be applied before replay-storage.sql';
  END IF;
END
$guard$;

DO $worker_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pvb_staging_worker') THEN
    CREATE ROLE pvb_staging_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$worker_role$;

-- Bounded retries: a receipt that exhausts 10 attempts is dead-lettered,
-- never retried forever. Matches the provider's own 10-delivery bound.
-- The bound is a literal in the claim function below so it stays visible
-- at the enforcement site.

ALTER TABLE public.piggyvest_staging_receipts
  ADD COLUMN IF NOT EXISTS claim_token uuid NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text NULL,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz NULL;

ALTER TABLE public.piggyvest_staging_receipts
  DROP CONSTRAINT IF EXISTS piggyvest_staging_receipts_status_check;
ALTER TABLE public.piggyvest_staging_receipts
  ADD CONSTRAINT piggyvest_staging_receipts_status_check
  CHECK (status IN ('quarantined', 'processing', 'processed', 'dead_letter'));

-- Atomic replay quarantine: one row per receipt, reasons sanitized by the
-- RPC check below. Detail is redacted JSON only, never raw payloads.
CREATE TABLE IF NOT EXISTS public.piggyvest_staging_replay_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL UNIQUE REFERENCES public.piggyvest_staging_receipts(id),
  event_id text NULL,
  reason text NOT NULL CHECK (reason IN ('unmapped', 'ambiguous', 'conflict', 'poison', 'unsupported', 'undecryptable', 'mapping-mismatch', 'authentication-failed', 'customer-mismatch', 'digest-mismatch', 'event-id-mismatch', 'invalid-event', 'invalid-json', 'invalid-receipt', 'unstable-event-id', 'unsupported-event')),
  detail jsonb NULL,
  attempts integer NOT NULL DEFAULT 0,
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz NULL,
  resolution text NULL
);

ALTER TABLE public.piggyvest_staging_replay_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piggyvest_staging_replay_quarantine FORCE ROW LEVEL SECURITY;

-- Claim: dead-letter exhausted rows, then lease the oldest quarantined
-- rows with SKIP LOCKED so concurrent workers never double-claim. The
-- token rotates on every claim; only the current holder can resolve.
CREATE OR REPLACE FUNCTION public.claim_piggyvest_staging_receipts(
  p_limit integer,
  p_lease_seconds integer
) RETURNS TABLE (
  receipt_id uuid,
  payload_sha256 text,
  ciphertext text,
  nonce text,
  auth_tag text,
  key_version text,
  claim_token uuid,
  attempts integer
)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid claim limit';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid lease window';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);

  UPDATE public.piggyvest_staging_receipts AS receipts
  SET status = 'dead_letter',
      claim_token = NULL,
      lease_expires_at = NULL,
      last_error = 'attempts exhausted'
  WHERE receipts.attempts >= 10
    AND receipts.status IN ('quarantined', 'processing')
    AND (receipts.lease_expires_at IS NULL
      OR receipts.lease_expires_at <= clock_timestamp());

  RETURN QUERY
  UPDATE public.piggyvest_staging_receipts AS receipts
  SET status = 'processing',
      claim_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = receipts.attempts + 1,
      last_error = NULL
  WHERE receipts.id IN (
    SELECT candidates.id
    FROM public.piggyvest_staging_receipts AS candidates
    -- Reap expired processing leases so a crashed worker cannot wedge
    -- a receipt below the dead-letter attempts ceiling.
    WHERE (candidates.status = 'quarantined'
      OR (candidates.status = 'processing'
        AND (candidates.lease_expires_at IS NULL
          OR candidates.lease_expires_at <= clock_timestamp())))
      AND candidates.attempts < 10
    ORDER BY candidates.received_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING receipts.id, receipts.payload_sha256, receipts.ciphertext,
    receipts.nonce, receipts.auth_tag, receipts.key_version,
    receipts.claim_token, receipts.attempts;
END
$function$;

-- Fenced resolve: only the current claim holder in processing state can
-- move the receipt. Stale tokens resolve nothing and report false.
CREATE OR REPLACE FUNCTION public.resolve_piggyvest_staging_receipt(
  p_receipt_id uuid,
  p_claim_token uuid,
  p_status text,
  p_last_error text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  affected integer := 0;
BEGIN
  IF p_status NOT IN ('processed', 'quarantined', 'dead_letter') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid resolve status';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  UPDATE public.piggyvest_staging_receipts
  SET status = p_status,
      claim_token = NULL,
      lease_expires_at = NULL,
      last_error = p_last_error,
      processed_at = CASE WHEN p_status = 'processed' THEN clock_timestamp() ELSE processed_at END
  WHERE id = p_receipt_id
    AND claim_token IS NOT DISTINCT FROM p_claim_token
    AND status = 'processing';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END
$function$;

-- Atomic quarantine: the quarantine row and the fenced resolve happen in
-- one transaction. A stale worker quarantines nothing and reports false.
CREATE OR REPLACE FUNCTION public.quarantine_piggyvest_staging_receipt(
  p_receipt_id uuid,
  p_claim_token uuid,
  p_event_id text,
  p_reason text,
  p_detail jsonb
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_reason NOT IN ('unmapped', 'ambiguous', 'conflict', 'poison', 'unsupported', 'undecryptable', 'mapping-mismatch', 'authentication-failed', 'customer-mismatch', 'digest-mismatch', 'event-id-mismatch', 'invalid-event', 'invalid-json', 'invalid-receipt', 'unstable-event-id', 'unsupported-event') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid quarantine reason';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  PERFORM 1 FROM public.piggyvest_staging_receipts
    WHERE id = p_receipt_id
      AND claim_token IS NOT DISTINCT FROM p_claim_token
      AND status = 'processing'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- Insert-then-update (not ON CONFLICT DO UPDATE): reading EXCLUDED
  -- would require SELECT on detail, which the worker role deliberately
  -- lacks. Both statements run in this function's transaction.
  INSERT INTO public.piggyvest_staging_replay_quarantine
    (receipt_id, event_id, reason, detail)
  VALUES (p_receipt_id, p_event_id, p_reason, p_detail)
  ON CONFLICT (receipt_id) DO NOTHING;
  IF NOT FOUND THEN
    UPDATE public.piggyvest_staging_replay_quarantine
    SET attempts = attempts + 1,
        detail = p_detail,
        resolved_at = NULL,
        resolution = NULL
    WHERE receipt_id = p_receipt_id;
  END IF;
  UPDATE public.piggyvest_staging_receipts
  SET status = 'quarantined',
      claim_token = NULL,
      lease_expires_at = NULL,
      last_error = p_reason
  WHERE id = p_receipt_id;
  RETURN true;
END
$function$;

-- Worker data access follows the ingest precedent (SECURITY INVOKER RPCs
-- plus narrow RLS policies and column grants): the RPCs provide atomic
-- lease fencing, while grants confine the role to exactly the lifecycle
-- columns it needs. No INSERT/DELETE/TRUNCATE on receipts, no access to
-- any other table.
REVOKE ALL ON TABLE public.piggyvest_staging_receipts
  FROM PUBLIC, anon, authenticated, pvb_staging_worker;
REVOKE ALL ON TABLE public.piggyvest_staging_replay_quarantine
  FROM PUBLIC, anon, authenticated, pvb_staging_worker;
GRANT SELECT (id, payload_sha256, ciphertext, nonce, auth_tag, key_version,
  claim_token, lease_expires_at, attempts, last_error, status, processed_at,
  received_at)
  ON TABLE public.piggyvest_staging_receipts TO pvb_staging_worker;
GRANT UPDATE (status, claim_token, lease_expires_at, attempts, last_error, processed_at)
  ON TABLE public.piggyvest_staging_receipts TO pvb_staging_worker;
GRANT SELECT (id, receipt_id, event_id, reason, attempts)
  ON TABLE public.piggyvest_staging_replay_quarantine TO pvb_staging_worker;
GRANT INSERT (receipt_id, event_id, reason, detail)
  ON TABLE public.piggyvest_staging_replay_quarantine TO pvb_staging_worker;
GRANT UPDATE (attempts, detail, resolved_at, resolution)
  ON TABLE public.piggyvest_staging_replay_quarantine TO pvb_staging_worker;
DROP POLICY IF EXISTS pvb_staging_worker_receipts ON public.piggyvest_staging_receipts;
DROP POLICY IF EXISTS pvb_staging_worker_quarantine ON public.piggyvest_staging_replay_quarantine;
CREATE POLICY pvb_staging_worker_receipts ON public.piggyvest_staging_receipts
  FOR ALL TO pvb_staging_worker USING (true) WITH CHECK (true);
CREATE POLICY pvb_staging_worker_quarantine ON public.piggyvest_staging_replay_quarantine
  FOR ALL TO pvb_staging_worker USING (true) WITH CHECK (true);
REVOKE ALL ON FUNCTION public.claim_piggyvest_staging_receipts(integer, integer)
  FROM PUBLIC, anon, authenticated, pvb_staging_ingest;
REVOKE ALL ON FUNCTION public.resolve_piggyvest_staging_receipt(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, pvb_staging_ingest;
REVOKE ALL ON FUNCTION public.quarantine_piggyvest_staging_receipt(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, pvb_staging_ingest;
GRANT EXECUTE ON FUNCTION public.claim_piggyvest_staging_receipts(integer, integer) TO pvb_staging_worker;
GRANT EXECUTE ON FUNCTION public.resolve_piggyvest_staging_receipt(uuid, uuid, text, text) TO pvb_staging_worker;
GRANT EXECUTE ON FUNCTION public.quarantine_piggyvest_staging_receipt(uuid, uuid, text, text, jsonb) TO pvb_staging_worker;

-- Database identity pin: lets the runner prove WHICH database it reached
-- (pg_control_system is cluster-stable), so a correct URL pointing at the
-- wrong database still refuses. Read-only; worker may execute it.
CREATE OR REPLACE FUNCTION public.piggyvest_staging_system_id()
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT system_identifier::text FROM pg_control_system()
$function$;
REVOKE ALL ON FUNCTION public.piggyvest_staging_system_id()
  FROM PUBLIC, anon, authenticated, pvb_staging_ingest;
GRANT EXECUTE ON FUNCTION public.piggyvest_staging_system_id() TO pvb_staging_worker;

DO $audit$
DECLARE
  unsafe_object text;
BEGIN
  -- Worker must never gain receipt INSERT/DELETE/TRUNCATE or any access
  -- outside the two replay tables and the three RPCs.
  IF has_table_privilege('pvb_staging_worker',
      'public.piggyvest_staging_receipts', 'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Worker role holds write access beyond lifecycle columns';
  END IF;
  IF has_table_privilege('pvb_staging_worker',
      'public.piggyvest_staging_replay_quarantine', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Worker role holds quarantine access beyond review/insert';
  END IF;
  SELECT format('%I.%I', namespace.nspname, relation.relname) INTO unsafe_object
  FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname !~ '^pg_toast'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND relation.oid NOT IN (
      'public.piggyvest_staging_receipts'::regclass,
      'public.piggyvest_staging_replay_quarantine'::regclass)
    AND (has_table_privilege('pvb_staging_worker', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('pvb_staging_worker', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'Worker role reaches outside replay storage: %', unsafe_object;
  END IF;
  SELECT format('%I.%I', namespace.nspname, routine.proname) INTO unsafe_object
  FROM pg_proc AS routine JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND routine.prosecdef AND has_function_privilege('pvb_staging_worker', routine.oid, 'EXECUTE')
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'Unsafe SECURITY DEFINER execution for worker: %', unsafe_object;
  END IF;
END
$audit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
