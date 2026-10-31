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
--
-- The SECURITY DEFINER functions, their grants and the evidence-immutability
-- trigger are in 20261030231100_piggyvest_webhook_durable_capture_functions.sql.

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

