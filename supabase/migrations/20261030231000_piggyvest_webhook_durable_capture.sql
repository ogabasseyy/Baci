-- Durable, always-on capture of authentic PiggyVest webhook deliveries (R5).
--
-- Every request whose x-pvb-signature verifies under a CURRENT key (a
-- configured key, or a retired key still inside its bounded rotation
-- overlap) is stored here, byte for byte, before the receiver answers 200.
-- That covers every event type including ones we do not recognise yet.
-- Processing is a separate step that consumes these rows; replaying a row
-- is idempotent because the downstream ledgers key on the provider
-- transaction id.
--
-- Raw bodies carry bank account numbers and names. The table is therefore
-- unreachable for anon/authenticated and service_role has no table
-- privilege at all: the only door is the SECURITY DEFINER functions below,
-- executable by service_role alone.

CREATE TABLE public.piggyvest_webhook_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL
    CONSTRAINT piggyvest_webhook_captures_event_key_check
    CHECK (octet_length(event_key) BETWEEN 1 AND 600),
  provider_event_id text NULL
    CONSTRAINT piggyvest_webhook_captures_provider_event_id_check
    CHECK (provider_event_id IS NULL OR octet_length(provider_event_id) BETWEEN 1 AND 512),
  event_type text NULL
    CONSTRAINT piggyvest_webhook_captures_event_type_check
    CHECK (event_type IS NULL OR octet_length(event_type) BETWEEN 1 AND 200),
  provider_transaction_id text NULL
    CONSTRAINT piggyvest_webhook_captures_provider_transaction_id_check
    CHECK (provider_transaction_id IS NULL OR octet_length(provider_transaction_id) BETWEEN 1 AND 512),
  body_digest text NOT NULL
    CONSTRAINT piggyvest_webhook_captures_body_digest_check
    CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  raw_body bytea NOT NULL
    CONSTRAINT piggyvest_webhook_captures_raw_body_check
    CHECK (octet_length(raw_body) <= 65536),
  signature text NOT NULL
    CONSTRAINT piggyvest_webhook_captures_signature_check
    CHECK (signature ~ '^[0-9a-f]{128}$'),
  request_headers jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT piggyvest_webhook_captures_request_headers_check
    CHECK (jsonb_typeof(request_headers) = 'object' AND octet_length(request_headers::text) <= 8192),
  key_version text NOT NULL
    CONSTRAINT piggyvest_webhook_captures_key_version_check
    CHECK (key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  key_families text[] NOT NULL
    CONSTRAINT piggyvest_webhook_captures_key_families_check
    CHECK (
      cardinality(key_families) BETWEEN 1 AND 4
      AND key_families <@ ARRAY['legacy', 'bank', 'custody', 'interest']::text[]
    ),
  -- The matched signing families as one canonical string (sorted, comma
  -- separated). Part of the capture identity: the same bytes first signed by
  -- the wrong key family and later redelivered under the right one are two
  -- rows, each keeping its own signature as immutable evidence.
  signing_families text NOT NULL
    CONSTRAINT piggyvest_webhook_captures_signing_families_check
    CHECK (signing_families ~ '^(legacy|bank|custody|interest)(,(legacy|bank|custody|interest)){0,3}$'),
  key_status text NOT NULL
    CONSTRAINT piggyvest_webhook_captures_key_status_check
    CHECK (key_status IN ('current', 'overlap')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processing_state text NOT NULL DEFAULT 'pending'
    CONSTRAINT piggyvest_webhook_captures_processing_state_check
    CHECK (processing_state IN ('pending', 'claimed', 'processed', 'needs_review')),
  attempts integer NOT NULL DEFAULT 0
    CONSTRAINT piggyvest_webhook_captures_attempts_check CHECK (attempts >= 0),
  -- Retry scheduling for rows the drain cannot verify YET because the key
  -- configuration is incomplete (keys unconfigured, an unreadable archive or
  -- family). Such a row is not failing: it is released with a bounded
  -- backoff, does not spend `attempts`, and is never dead-lettered. Without
  -- this the oldest blocked rows would be re-claimed first on every run and
  -- starve every later capture. NULL means no retry time is pending.
  config_deferrals integer NOT NULL DEFAULT 0
    CONSTRAINT piggyvest_webhook_captures_config_deferrals_check
    CHECK (config_deferrals BETWEEN 0 AND 1000),
  next_attempt_at timestamptz NULL,
  last_error text NULL
    CONSTRAINT piggyvest_webhook_captures_last_error_check
    CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  claim_token uuid NULL,
  lease_until timestamptz NULL,
  processed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT piggyvest_webhook_captures_identity_key
    UNIQUE (event_key, body_digest, signing_families)
);

-- Claim order: a deferred row sorts by when it becomes retryable, so it
-- re-enters the queue behind work that arrived earlier.
CREATE INDEX piggyvest_webhook_captures_unprocessed_idx
  ON public.piggyvest_webhook_captures (
    (COALESCE(next_attempt_at, received_at)), received_at, id
  )
  WHERE processing_state IN ('pending', 'claimed');

CREATE INDEX piggyvest_webhook_captures_transaction_idx
  ON public.piggyvest_webhook_captures (provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

ALTER TABLE public.piggyvest_webhook_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY piggyvest_webhook_captures_deny_all
  ON public.piggyvest_webhook_captures
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.piggyvest_webhook_captures
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.piggyvest_webhook_captures IS
  'Byte-exact PiggyVest webhook deliveries that verified under a current key. Contains PII; reachable only through the capture functions.';

-- The captured evidence never changes after insert; only the processing
-- bookkeeping columns move.
CREATE FUNCTION public.piggyvest_webhook_captures_immutable_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.event_key IS DISTINCT FROM OLD.event_key
    OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id
    OR NEW.body_digest IS DISTINCT FROM OLD.body_digest
    OR NEW.raw_body IS DISTINCT FROM OLD.raw_body
    OR NEW.signature IS DISTINCT FROM OLD.signature
    OR NEW.request_headers IS DISTINCT FROM OLD.request_headers
    OR NEW.key_version IS DISTINCT FROM OLD.key_version
    OR NEW.key_families IS DISTINCT FROM OLD.key_families
    OR NEW.signing_families IS DISTINCT FROM OLD.signing_families
    OR NEW.key_status IS DISTINCT FROM OLD.key_status
    OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'captured webhook evidence is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.piggyvest_webhook_captures_immutable_evidence()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER piggyvest_webhook_captures_immutable_evidence
  BEFORE UPDATE ON public.piggyvest_webhook_captures
  FOR EACH ROW
  EXECUTE FUNCTION public.piggyvest_webhook_captures_immutable_evidence();

-- Capture: one atomic INSERT ... ON CONFLICT DO NOTHING. A rejected command
-- raises before any row exists, so there is never a partial row. Duplicate
-- deliveries (same provider event id, identical body digest AND the same
-- matched signing families) store nothing new and report the existing row.
-- A delivery whose signing families differ is a different capture: a
-- correctly signed redelivery of bytes first seen under the wrong family
-- keeps its own signature, and replay verifies each row on its own.
CREATE FUNCTION public.capture_piggyvest_webhook_delivery(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_raw_hex text;
  v_payload bytea;
  v_digest text;
  v_event_id text;
  v_headers jsonb;
  v_families text[];
  v_signing text;
  v_id uuid;
  v_state text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid webhook capture command' USING ERRCODE = '22023';
  END IF;
  v_raw_hex := p_command->>'rawHex';
  IF jsonb_typeof(p_command->'rawHex') IS DISTINCT FROM 'string'
    OR v_raw_hex !~ '^([0-9a-f]{2})*$'
    OR length(v_raw_hex) > 131072 THEN
    RAISE EXCEPTION 'invalid captured webhook bytes' USING ERRCODE = '22023';
  END IF;
  v_payload := decode(v_raw_hex, 'hex');
  v_digest := encode(sha256(v_payload), 'hex');
  IF v_digest IS DISTINCT FROM p_command->>'bodyDigest' THEN
    RAISE EXCEPTION 'captured webhook digest mismatch' USING ERRCODE = '22023';
  END IF;
  v_event_id := nullif(p_command->>'eventId', '');
  v_headers := coalesce(p_command->'headers', '{}'::jsonb);
  IF jsonb_typeof(p_command->'keyFamilies') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid captured webhook key families' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT family ORDER BY family)
    INTO v_families
    FROM jsonb_array_elements_text(p_command->'keyFamilies') AS family;
  v_signing := array_to_string(v_families, ',');

  INSERT INTO public.piggyvest_webhook_captures (
    event_key, provider_event_id, event_type, provider_transaction_id,
    body_digest, raw_body, signature, request_headers,
    key_version, key_families, signing_families, key_status
  ) VALUES (
    coalesce(v_event_id, 'raw:' || v_digest), v_event_id,
    nullif(p_command->>'eventType', ''),
    nullif(p_command->>'providerTransactionId', ''),
    v_digest, v_payload, p_command->>'signature', v_headers,
    p_command->>'keyVersion', v_families, v_signing, p_command->>'keyStatus'
  )
  ON CONFLICT (event_key, body_digest, signing_families) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'captured', 'id', v_id, 'processingState', 'pending');
  END IF;
  SELECT c.id, c.processing_state INTO v_id, v_state
    FROM public.piggyvest_webhook_captures c
    WHERE c.event_key = coalesce(v_event_id, 'raw:' || v_digest)
      AND c.body_digest = v_digest
      AND c.signing_families = v_signing;
  RETURN jsonb_build_object('outcome', 'duplicate', 'id', v_id, 'processingState', v_state);
END
$$;

-- Worker claim: leases due rows (pending long enough for inline processing
-- to have finished and past any deferral retry time, or an expired lease
-- from a crashed worker). Rows are taken in the order they became eligible,
-- COALESCE(next_attempt_at, received_at), so a configuration-deferred row
-- cannot monopolise a batch ahead of fresher work.
CREATE FUNCTION public.claim_piggyvest_webhook_captures(
  p_limit integer,
  p_lease_seconds integer,
  p_min_age_seconds integer
)
RETURNS TABLE (
  capture_id uuid,
  claim_token uuid,
  raw_hex text,
  signature text,
  key_version text,
  key_families text[],
  attempts integer,
  event_type text,
  provider_transaction_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH due AS (
    SELECT c.id
    FROM public.piggyvest_webhook_captures c
    WHERE (
      c.processing_state = 'pending'
      AND c.received_at <= clock_timestamp() - make_interval(secs => greatest(p_min_age_seconds, 0))
      AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= clock_timestamp())
    ) OR (
      c.processing_state = 'claimed'
      AND c.lease_until < clock_timestamp()
    )
    ORDER BY COALESCE(c.next_attempt_at, c.received_at), c.received_at, c.id
    LIMIT least(greatest(p_limit, 1), 100)
    FOR UPDATE SKIP LOCKED
  ), taken AS (
    UPDATE public.piggyvest_webhook_captures c
    SET processing_state = 'claimed',
        claim_token = gen_random_uuid(),
        lease_until = clock_timestamp() + make_interval(secs => least(greatest(p_lease_seconds, 30), 3600)),
        attempts = c.attempts + 1,
        updated_at = clock_timestamp()
    FROM due
    WHERE c.id = due.id
    RETURNING c.id, c.claim_token, c.raw_body, c.signature, c.key_version,
      c.key_families, c.attempts, c.event_type, c.provider_transaction_id, c.received_at,
      c.next_attempt_at
  )
  SELECT t.id, t.claim_token, encode(t.raw_body, 'hex'), t.signature,
    t.key_version, t.key_families, t.attempts, t.event_type, t.provider_transaction_id
  FROM taken t
  ORDER BY COALESCE(t.next_attempt_at, t.received_at), t.received_at, t.id
$$;

-- Completion. With a claim token the row must be leased to the caller. With
-- none (inline processing right after capture) only a still-pending row can
-- be completed, so a stale inline finisher can never overwrite worker state.
--
-- 'pending' releases the row at once and keeps the attempt it spent.
-- 'deferred' is for a row that cannot be verified yet because key
-- configuration is incomplete: it returns to pending, refunds the attempt
-- the claim spent (so a configuration outage never exhausts the processing
-- budget), and schedules a retry 60s * 2^deferrals out, capped at one hour.
CREATE FUNCTION public.resolve_piggyvest_webhook_capture(
  p_id uuid,
  p_claim_token uuid,
  p_state text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('pending', 'processed', 'needs_review', 'deferred') THEN
    RAISE EXCEPTION 'invalid webhook capture state' USING ERRCODE = '22023';
  END IF;
  IF p_claim_token IS NULL AND p_state IN ('needs_review', 'deferred') THEN
    RAISE EXCEPTION 'review and deferral states require a claim' USING ERRCODE = '22023';
  END IF;
  UPDATE public.piggyvest_webhook_captures c
  SET processing_state = CASE WHEN p_state = 'deferred' THEN 'pending' ELSE p_state END,
      last_error = left(p_error, 200),
      attempts = CASE
        WHEN p_state = 'deferred' THEN greatest(c.attempts - 1, 0)
        ELSE c.attempts
      END,
      config_deferrals = CASE
        WHEN p_state = 'deferred' THEN least(c.config_deferrals + 1, 1000)
        ELSE c.config_deferrals
      END,
      next_attempt_at = CASE
        WHEN p_state = 'deferred' THEN clock_timestamp() + make_interval(
          secs => least(3600::double precision, 60 * power(2, least(c.config_deferrals, 10)))
        )
        ELSE c.next_attempt_at
      END,
      processed_at = CASE WHEN p_state = 'processed' THEN clock_timestamp() ELSE c.processed_at END,
      claim_token = NULL,
      lease_until = NULL,
      updated_at = clock_timestamp()
  WHERE c.id = p_id
    AND (
      (p_claim_token IS NOT NULL AND c.processing_state = 'claimed' AND c.claim_token = p_claim_token)
      OR (p_claim_token IS NULL AND c.processing_state = 'pending')
    );
  RETURN FOUND;
END
$$;

-- Operational counters for the readiness verifier and alerting. Metadata
-- only: never bodies, signatures or headers.
CREATE FUNCTION public.piggyvest_webhook_capture_status()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE processing_state = 'pending'),
    'claimed', count(*) FILTER (WHERE processing_state = 'claimed'),
    'needsReview', count(*) FILTER (WHERE processing_state = 'needs_review'),
    'oldestUnprocessedAt', min(received_at) FILTER (WHERE processing_state IN ('pending', 'claimed')),
    'lastCapturedAt', max(received_at),
    'lastProcessedAt', max(processed_at)
  )
  FROM public.piggyvest_webhook_captures
$$;

REVOKE ALL ON FUNCTION public.capture_piggyvest_webhook_delivery(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_piggyvest_webhook_captures(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_piggyvest_webhook_capture(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.piggyvest_webhook_capture_status()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.capture_piggyvest_webhook_delivery(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_piggyvest_webhook_captures(integer, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_piggyvest_webhook_capture(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.piggyvest_webhook_capture_status()
  TO service_role;
