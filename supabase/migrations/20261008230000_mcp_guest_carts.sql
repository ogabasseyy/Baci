-- ---------------------------------------------------------------------------
-- MCP guest carts: Postgres-backed ephemeral carts. The token remains the
-- capability: only its holder can name it, and all access goes through
-- the SECURITY DEFINER RPCs below — the table itself is unreachable via
-- PostgREST (RLS on, all role grants revoked). Concurrent updates to one
-- token serialize through the per-row version gate; the TS caller
-- re-reads and retries on conflict.
--
-- Least privilege: the MCP server presents a worker JWT (role claim
-- mcp_guest_cart_worker), never the service key — the anon key is
-- publicly distributed and the service key bypasses all RLS, so neither
-- may back user-facing cart operations. Only the worker role holds
-- EXECUTE on the caller RPCs; retention stays service-role-only for the
-- pg_cron schedule below.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_guest_cart_worker') THEN
    CREATE ROLE mcp_guest_cart_worker NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Converge a pre-existing worker role: NOLOGIN + PASSWORD NULL so a later
-- accidental LOGIN cannot resurrect password auth; a no-op on fresh
-- chains, where the role was just created NOLOGIN above.
ALTER ROLE mcp_guest_cart_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;

GRANT USAGE ON SCHEMA public TO mcp_guest_cart_worker;
-- PostgREST serves every request as authenticator and SET ROLEs to the
-- JWT claim, but the membership grant lives in the isolate migration
-- (20261010100000), not here: every role inherits PUBLIC privileges,
-- so granting membership before the request-scope hook confines this
-- role would let a leaked worker token invoke other PUBLIC-executable
-- RPCs. Deploy sequencing mirrors the GIGL/blog-media ceremony: the
-- scope migration (20261010090000) extends the pre-request allowlist
-- with the three cart RPCs, probe-guest-cart-hook-reload.sh observes
-- unanimous reload-canary acks fleet-wide, then the isolate migration
-- grants membership. Never grant here: PostgreSQL exposes membership
-- at commit while PostgREST reloads asynchronously.
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
  'Reachable exclusively through the worker-only SECURITY DEFINER '
  'get/upsert/delete RPCs; RLS on and all role grants revoked. Neither '
  'the public anon key nor the RLS-bypassing service key may back '
  'user-facing cart operations. Expired rows are dead weight the '
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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mcp_guest_cart(text)
  TO mcp_guest_cart_worker;

COMMENT ON FUNCTION public.get_mcp_guest_cart(text) IS
  'Reads one MCP guest cart by capability token. Returns zero rows for '
  'unknown tokens; expired rows are returned for the caller to enforce.';

-- Write RPCs (upsert/delete/cleanup) plus the retention schedule live in
-- 20261008230100_mcp_guest_cart_write_rpcs.sql, next in version order.
