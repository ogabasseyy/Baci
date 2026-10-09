-- ---------------------------------------------------------------------------
-- MCP guest carts: Postgres-backed ephemeral carts replacing the
-- single-writer file store (mcp-guest-carts volume + .writer.lock +
-- heartbeat). The token remains the capability: only its holder can name
-- it, and all access goes through the SECURITY DEFINER RPCs below — the
-- table itself is unreachable via PostgREST (RLS on, all role grants
-- revoked). Concurrent updates to one token serialize through the
-- per-row version gate; the TS caller re-reads and retries on conflict.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mcp_guest_carts (
  token text PRIMARY KEY CHECK (token ~ '^[a-f0-9]{64}$'),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Supports the bounded retention sweep below.
CREATE INDEX IF NOT EXISTS mcp_guest_carts_expires_at_idx
  ON public.mcp_guest_carts (expires_at);

ALTER TABLE public.mcp_guest_carts ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: strip default privileges so the store is unreachable
-- via PostgREST. RLS is enabled with no policy, so even a stray grant would
-- return zero rows.
REVOKE ALL ON TABLE public.mcp_guest_carts FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.mcp_guest_carts IS
  'Ephemeral MCP guest carts keyed by unguessable 64-hex capability token. '
  'Reachable exclusively through the SECURITY DEFINER get/upsert/delete RPCs; '
  'RLS on and all role grants revoked. Expired rows are dead weight the '
  'expires_at index exists to sweep.';

-- ---------------------------------------------------------------------------
-- Read one cart by capability token. Expired rows are returned (never
-- resurrected): the caller enforces expiry and reclaims them best-effort.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mcp_guest_cart(p_token text)
RETURNS TABLE(items jsonb, expires_at timestamptz, version bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.items, c.expires_at, c.version
  FROM public.mcp_guest_carts c
  WHERE c.token = p_token
$$;

ALTER FUNCTION public.get_mcp_guest_cart(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_mcp_guest_cart(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mcp_guest_cart(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_mcp_guest_cart(text) IS
  'Reads one MCP guest cart by capability token. Returns zero rows for '
  'unknown tokens; expired rows are returned for the caller to enforce.';

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
  IF p_expected_version IS NULL THEN
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.upsert_mcp_guest_cart(text, jsonb, timestamptz, bigint)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION
  public.upsert_mcp_guest_cart(text, jsonb, timestamptz, bigint) IS
  'Creates (NULL expected version) or version-gated updates one MCP guest '
  'cart. Outcomes: ok / conflict (retry) / missing / expired (recover).';

-- ---------------------------------------------------------------------------
-- Version-gated delete: retires emptied carts and reclaims expired rows.
-- Returns false when the version moved (a concurrent write landed) or the
-- row is gone; the caller re-reads instead of deleting blind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_mcp_guest_cart(
  p_token text,
  p_expected_version bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mcp_guest_carts
  WHERE token = p_token
    AND mcp_guest_carts.version = p_expected_version;
  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.delete_mcp_guest_cart(text, bigint) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.delete_mcp_guest_cart(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_mcp_guest_cart(text, bigint)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.delete_mcp_guest_cart(text, bigint) IS
  'Version-gated delete of one MCP guest cart. False when the row moved or '
  'is already gone.';

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
