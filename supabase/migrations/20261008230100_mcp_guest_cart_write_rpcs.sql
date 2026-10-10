-- ---------------------------------------------------------------------------
-- MCP guest-cart write RPCs: version-gated upsert/delete plus the bounded
-- retention sweep and its pg_cron schedule. Ordered group with
-- 20261008230000, which owns the role, table, and read RPC; split to hold
-- the 300-line file budget. Apply order follows the version prefix.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Create or version-gated update one cart. Creations pass a NULL expected
-- version: any conflict (live or expired row) reports ''conflict'' and the
-- caller mints a fresh token. Updates report ''ok'' only when the version
-- matches and the row is live; ''missing'' / ''expired'' / ''conflict''
-- tell the caller whether to recover or retry. No path resurrects an
-- expired row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_mcp_guest_cart(
  p_token text,
  p_items jsonb,
  p_expires_at timestamptz,
  p_expected_version bigint DEFAULT NULL
) RETURNS TABLE(version bigint, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.mcp_guest_carts%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid guest cart token';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'guest cart items must be an array';
  END IF;
  -- Mirror the TS store limits database-side so a compromised or buggy
  -- caller cannot persist oversized carts or far-future retention: 20
  -- lines max, and the 7-day sliding TTL plus headroom for clock skew.
  IF jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'guest cart holds at most 20 lines';
  END IF;
  IF p_expires_at > pg_catalog.now() + interval '8 days' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'guest cart expiry exceeds retention';
  END IF;
  -- Mirror the TS line shape database-side: a leaked worker token or a
  -- caller bug must not persist unbounded TOAST. Every element carries
  -- a canonical lowercase UUID product_id and a 1..10 quantity (NULLs
  -- rejected explicitly: NULL !~ pattern is NULL, not true), and the
  -- whole payload stays under 8 KiB — twenty legit lines fit in
  -- ~1.5 KiB, and the ceiling backstops junk keys the shape allows.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS element
    WHERE jsonb_typeof(element.value) <> 'object'
      OR element.value->>'product_id' IS NULL
      OR element.value->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR element.value->>'quantity' IS NULL
      -- CASE, not OR: SQL does not short-circuit, and casting
      -- non-numeric text would raise 22P02 instead of this 22023.
      OR CASE
        WHEN (element.value->>'quantity') !~ '^[0-9]{1,9}$' THEN TRUE
        ELSE (element.value->>'quantity')::integer NOT BETWEEN 1 AND 10
      END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid guest cart line';
  END IF;
  IF pg_catalog.pg_column_size(p_items) > 8192 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'guest cart payload exceeds size budget';
  END IF;
  IF p_expected_version IS NULL THEN
    -- Serialize creations against the capacity gate: without this, two
    -- transactions racing near the ceiling both observe the same
    -- pre-insert count and both insert, breaching the bound. The lock is
    -- transaction-scoped (auto-released; a single key cannot deadlock)
    -- and create-path-only — updates and deletes never change the row
    -- count. Arrival is already quota-bounded (600/hr/IP), so the
    -- critical section stays short.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_mcp_guest_cart_capacity', 0)
    );
    -- Global capacity gate: per-IP quotas cannot bound a botnet, and the
    -- hourly sweep reclaims at most 1000 rows, so the table itself must
    -- refuse creations past budget. The count covers dead rows too: under
    -- sustained abuse the caller retries after the next sweep instead of
    -- growing storage without bound. Legitimate volume never approaches
    -- this ceiling (carts are per-conversation and expire in 7 days).
    IF (SELECT count(*) FROM public.mcp_guest_carts) >= 50000 THEN
      version := NULL;
      outcome := 'full';
      RETURN NEXT;
      RETURN;
    END IF;
    BEGIN
      INSERT INTO public.mcp_guest_carts (token, items, expires_at)
      VALUES (p_token, p_items, p_expires_at)
      RETURNING mcp_guest_carts.version INTO version;
      outcome := 'ok';
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      version := NULL;
      outcome := 'conflict';
      RETURN NEXT;
      RETURN;
    END;
  END IF;
  UPDATE public.mcp_guest_carts
  SET items = p_items,
      expires_at = p_expires_at,
      version = mcp_guest_carts.version + 1,
      updated_at = pg_catalog.now()
  WHERE token = p_token
    AND mcp_guest_carts.version = p_expected_version
    AND expires_at > pg_catalog.now()
  RETURNING mcp_guest_carts.version INTO version;
  IF FOUND THEN
    outcome := 'ok';
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT * INTO v_row FROM public.mcp_guest_carts WHERE token = p_token;
  IF NOT FOUND THEN
    version := NULL;
    outcome := 'missing';
  ELSIF v_row.expires_at <= pg_catalog.now() THEN
    version := v_row.version;
    outcome := 'expired';
  ELSE
    version := v_row.version;
    outcome := 'conflict';
  END IF;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.upsert_mcp_guest_cart(text, jsonb, timestamptz, bigint)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.upsert_mcp_guest_cart(text, jsonb, timestamptz, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.upsert_mcp_guest_cart(text, jsonb, timestamptz, bigint)
  TO mcp_guest_cart_worker;

COMMENT ON FUNCTION
  public.upsert_mcp_guest_cart(text, jsonb, timestamptz, bigint) IS
  'Creates (NULL expected version) or version-gated updates one MCP guest '
  'cart. Outcomes: ok / conflict (retry) / missing / expired (recover) / '
  'full (global capacity reached).';

-- ---------------------------------------------------------------------------
-- Version-gated delete: retires emptied carts and reclaims expired rows.
-- Returns false when the version moved (a concurrent write landed) or the
-- row is gone; the caller re-reads instead of deleting blind. A NULL
-- expected version deletes unconditionally: the caller passes it only
-- when the row's own version bytes are corrupt (nothing could match),
-- and the token still scopes the blast radius to one cart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_mcp_guest_cart(
  p_token text,
  p_expected_version bigint DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mcp_guest_carts
  WHERE token = p_token
    AND (
      p_expected_version IS NULL
      OR mcp_guest_carts.version = p_expected_version
    );
  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.delete_mcp_guest_cart(text, bigint) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.delete_mcp_guest_cart(text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_mcp_guest_cart(text, bigint)
  TO mcp_guest_cart_worker;

COMMENT ON FUNCTION public.delete_mcp_guest_cart(text, bigint) IS
  'Version-gated delete of one MCP guest cart (NULL expected version '
  'deletes unconditionally for corrupt rows). False when the row moved '
  'or is already gone.';

-- ---------------------------------------------------------------------------
-- Bounded retention. Guest carts expire lazily on read; this sweep reclaims
-- the dead rows in capped batches without a long lock. Service-role only —
-- never anon/authenticated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_mcp_guest_carts(
  p_limit integer DEFAULT 1000
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT token
    FROM public.mcp_guest_carts
    WHERE expires_at <= pg_catalog.now()
    ORDER BY expires_at
    LIMIT GREATEST(COALESCE(p_limit, 1000), 1)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.mcp_guest_carts t
  USING doomed
  WHERE t.token = doomed.token;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.cleanup_mcp_guest_carts(integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.cleanup_mcp_guest_carts(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_mcp_guest_carts(integer)
  TO service_role;

COMMENT ON FUNCTION public.cleanup_mcp_guest_carts(integer) IS
  'MCP guest-cart retention: deletes up to p_limit expired rows '
  '(FOR UPDATE SKIP LOCKED). Service-role only, run by the pg_cron schedule below.';

-- ---------------------------------------------------------------------------
-- Schedule the retention sweep via pg_cron (already installed). Hourly at
-- :47 (off-peak minute; :17/:23/:37 are taken). Idempotent: guarded on the
-- cron schema existing (a no-op in any environment without pg_cron, e.g. a
-- from-scratch replay), and re-runnable (unschedule the prior job of the
-- same name first). Without this the cart table would grow unbounded, since
-- reads enforce expiry lazily without deleting.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'mcp-guest-cart-cleanup'
    ) THEN
      PERFORM cron.unschedule('mcp-guest-cart-cleanup');
    END IF;
    PERFORM cron.schedule(
      'mcp-guest-cart-cleanup',
      '47 * * * *',
      $cron$SELECT public.cleanup_mcp_guest_carts(1000)$cron$
    );
  END IF;
END $$;
