-- Production-only connector rollout under a fresh, non-colliding version.
-- Original proof migrations remain unchanged. Apply using the reviewed
-- production bundle; do not push the entire legacy proof checkout.
-- Inventory policy is owner-only from its first creation.


-- Source: 20261001090000_connector_grants_r0.sql
-- SHA256: 298c2aa4d228f84d19205898121918faa168844e11a15828e0d002b18c25e608
-- R0 connector grants: delegation records for the Muse pilot connector.
--
-- A grant binds one Muse connection to one Baci user, one merchant, an
-- explicit branch allowlist, and a deny-by-default scope set. Only sha256
-- hashes of opaque tokens are stored; no secrets, no payment credentials.
--
-- Write path is RPC-only: authenticated members hold no table-wide INSERT,
-- UPDATE, or DELETE privilege. Creation binds user_id to auth.uid(),
-- rotation touches hashes only (no scope expansion), revocation is a
-- member-checked forward transition, and token hashes are excluded from
-- column SELECT grants. See docs/connectors/muse-r0-design.md.

CREATE TABLE IF NOT EXISTS public.connector_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE CASCADE,
  branch_ids uuid[] NOT NULL DEFAULT '{}',
  merchant_wide boolean NOT NULL DEFAULT false,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  token_hash text NOT NULL,
  refresh_token_hash text,
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connector_grants_status_check
    CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT connector_grants_version_check CHECK (version >= 1),
  CONSTRAINT connector_grants_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT connector_grants_refresh_hash_check
    CHECK (
      refresh_token_hash IS NULL
      OR refresh_token_hash ~ '^[0-9a-f]{64}$'
    ),
  -- Stored scopes stay within the allowlist. Containment evaluates to
  -- non-TRUE for NULL elements, so malformed arrays are rejected here
  -- even on direct table writes.
  CONSTRAINT connector_grants_scopes_check
    CHECK (
      scopes <@ ARRAY[
        'orders:read', 'inventory:read', 'analytics:read', 'events:read'
      ]
    )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connector_grants_connection_id_key'
  ) THEN
    ALTER TABLE public.connector_grants
      ADD CONSTRAINT connector_grants_connection_id_key UNIQUE (connection_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connector_grants_token_hash_key'
  ) THEN
    ALTER TABLE public.connector_grants
      ADD CONSTRAINT connector_grants_token_hash_key UNIQUE (token_hash);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connector_grants_refresh_token_hash_key'
  ) THEN
    ALTER TABLE public.connector_grants
      ADD CONSTRAINT connector_grants_refresh_token_hash_key UNIQUE (refresh_token_hash);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_connector_grants_merchant
  ON public.connector_grants (merchant_id);
CREATE INDEX IF NOT EXISTS idx_connector_grants_user
  ON public.connector_grants (user_id);
CREATE INDEX IF NOT EXISTS idx_connector_grants_merchant_status
  ON public.connector_grants (merchant_id, status);

ALTER TABLE public.connector_grants ENABLE ROW LEVEL SECURITY;

-- Least-privilege gateway role (R1 runtime reads use it; R0 proves the
-- mechanism). Membership in authenticated permits the per-transaction
-- SET LOCAL ROLE; data reads then flow through RLS as the linked user.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'connector_gateway') THEN
    CREATE ROLE connector_gateway NOLOGIN;
  END IF;
END
$$;
GRANT authenticated TO connector_gateway;

-- Column-scoped read: members see grant metadata, never token hashes.
REVOKE ALL ON public.connector_grants FROM anon, authenticated;
GRANT SELECT (
  id, connection_id, user_id, merchant_id, branch_ids, merchant_wide,
  scopes, status, version, expires_at, revoked_at, revoke_reason,
  created_at, updated_at
) ON public.connector_grants TO authenticated;

-- No INSERT / UPDATE / DELETE policies: all writes go through the RPCs
-- below, which re-check live membership on every call.

DROP POLICY IF EXISTS "connector_grants_member_select" ON public.connector_grants;
CREATE POLICY "connector_grants_member_select"
  ON public.connector_grants
  FOR SELECT
  TO authenticated
  USING (public.has_merchant_access(merchant_id));

-- Forward-only status transitions as defense in depth (the RPCs are the
-- only writers, but no code path may resurrect a revoked grant).
CREATE OR REPLACE FUNCTION public.enforce_connector_grant_status_flow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'active' AND NEW.status IN ('revoked', 'expired') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'expired' AND NEW.status = 'revoked' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid_connector_grant_status_transition';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_connector_grant_status_flow()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_connector_grant_status_flow
  ON public.connector_grants;
CREATE TRIGGER enforce_connector_grant_status_flow
  BEFORE UPDATE OF status ON public.connector_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_connector_grant_status_flow();

-- Create a grant bound to the calling member. Validates merchant access,
-- manager authority, scope allowlist, branch ownership, and hash format.
CREATE OR REPLACE FUNCTION public.create_connector_grant(
  p_merchant_id uuid,
  p_connection_id text,
  p_branch_ids uuid[],
  p_scopes text[],
  p_merchant_wide boolean,
  p_expires_at timestamptz,
  p_token_hash text,
  p_refresh_token_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_is_owner boolean;
  v_grant_id uuid;
BEGIN
  v_caller := (SELECT auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = p_merchant_id AND m.user_id = v_caller
  ) INTO v_is_owner;

  IF NOT v_is_owner AND NOT public.check_staff_permission(
    v_caller, p_merchant_id, 'settings', 'edit'
  ) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_merchant_wide AND NOT v_is_owner THEN
    RAISE EXCEPTION 'connector_grant_merchant_wide_requires_owner';
  END IF;

  IF p_connection_id IS NULL OR trim(p_connection_id) = '' THEN
    RAISE EXCEPTION 'invalid_connector_grant';
  END IF;

  -- NULL elements fail closed: `NOT IN` alone would admit them.
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_scopes, '{}')) s
    WHERE s IS NULL
      OR s NOT IN ('orders:read', 'inventory:read', 'analytics:read', 'events:read')
  ) THEN
    RAISE EXCEPTION 'invalid_connector_grant_scope';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_branch_ids, '{}')) b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.branches br
      WHERE br.id = b AND br.merchant_id = p_merchant_id AND br.active = true
    )
  ) THEN
    RAISE EXCEPTION 'invalid_connector_grant_branch';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;
  IF p_refresh_token_hash IS NOT NULL
    AND p_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;

  INSERT INTO public.connector_grants (
    connection_id, user_id, merchant_id, branch_ids, merchant_wide,
    scopes, status, token_hash, refresh_token_hash, version, expires_at
  ) VALUES (
    trim(p_connection_id), v_caller, p_merchant_id,
    COALESCE(p_branch_ids, '{}'), COALESCE(p_merchant_wide, false),
    COALESCE(p_scopes, '{}'), 'active',
    p_token_hash, p_refresh_token_hash, 1, p_expires_at
  )
  RETURNING id INTO v_grant_id;

  RETURN v_grant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_connector_grant(
  uuid, text, uuid[], text[], boolean, timestamptz, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_connector_grant(
  uuid, text, uuid[], text[], boolean, timestamptz, text, text
) TO authenticated;

-- Rotate hashes after a refresh. The gateway presents the current
-- refresh-token hash as the credential (it holds no user session), so this
-- RPC authenticates by hash, rechecks live membership for the linked user,
-- and rotates to gateway-supplied hashes. Scopes, branches, and merchant
-- binding are never modified here, so rotation cannot expand authority.
CREATE OR REPLACE FUNCTION public.rotate_connector_grant_tokens(
  p_refresh_token_hash text,
  p_new_token_hash text,
  p_new_refresh_token_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant record;
BEGIN
  IF p_refresh_token_hash IS NULL
    OR p_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  IF p_new_token_hash IS NULL OR p_new_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;
  IF p_new_refresh_token_hash IS NOT NULL
    AND p_new_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;

  SELECT id, user_id, merchant_id, status, expires_at INTO v_grant
  FROM public.connector_grants
  WHERE refresh_token_hash = p_refresh_token_hash;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_grant.status <> 'active'
    OR (v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now()) THEN
    RETURN false;
  END IF;

  -- Live membership for the linked user (owner or active staff). Rotation
  -- is credential-authenticated, so auth.uid() plays no role here.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_grant.merchant_id AND m.user_id = v_grant.user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.merchant_id = v_grant.merchant_id
      AND sm.user_id = v_grant.user_id
      AND sm.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.connector_grants
  SET token_hash = p_new_token_hash,
      refresh_token_hash = p_new_refresh_token_hash,
      version = version + 1,
      updated_at = now()
  WHERE id = v_grant.id
    AND status = 'active'
    AND refresh_token_hash = p_refresh_token_hash;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_connector_grant_tokens(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_connector_grant_tokens(text, text, text)
  TO connector_gateway;

-- Member-executed revocation. Verifies live merchant access inside the RPC
-- so a caller whose role was removed cannot revoke (or touch) grants.
CREATE OR REPLACE FUNCTION public.revoke_connector_grant(
  p_grant_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  SELECT merchant_id INTO v_merchant_id
  FROM public.connector_grants
  WHERE id = p_grant_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT public.has_merchant_access(v_merchant_id) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.connector_grants
  SET status = 'revoked',
      revoked_at = now(),
      revoke_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
      refresh_token_hash = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_grant_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_connector_grant(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_connector_grant(uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- R0 proof: credential-to-RLS path (resolved design, §5 option C-prime).
--
-- The gateway holds no user session, so each connector call starts by
-- validating the opaque token here: hash match, active status, expiry,
-- live role permission, scope allowlist, and branch containment. The RPC
-- returns the resolved context; the gateway then runs its data reads over a
-- direct pooled connection as a least-privilege gateway role (member of
-- authenticated) with per-transaction SET LOCAL role + jwt claims, so every
-- row flows through the existing RLS policies as the linked user. No
-- service-role client, no JWT minting, no replicated policy logic.
--
-- (PostgreSQL forbids SET ROLE inside SECURITY DEFINER functions, so the
-- role switch must stay in the gateway; the scratch proof confirmed
-- `cannot set parameter "role" within security-definer function`. The
-- resolver sets local claims for its permission checks; the gateway then
-- establishes the role/claims used for RLS reads. See the design doc.)
--
-- The gateway must rate-limit token-hash lookups at the edge (hashes are
-- high-entropy, but this RPC is callable without a user session).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_connector_grant_context(
  p_token_hash text,
  p_scope text,
  p_resource text,
  p_action text,
  p_branch_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  grant_id uuid,
  user_id uuid,
  merchant_id uuid,
  branch_ids uuid[],
  merchant_wide boolean,
  scopes text[],
  grant_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant record;
  v_is_owner boolean;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'connector_grant_invalid';
  END IF;

  -- Tool parameters are allowlisted so a caller cannot smuggle an
  -- unintended permission check through this boundary. NULLs fail closed:
  -- a NULL scope or resource would otherwise bypass the checks below.
  IF p_scope IS NULL OR p_resource IS NULL OR p_action IS NULL THEN
    RAISE EXCEPTION 'connector_scope_denied';
  END IF;
  IF p_scope NOT IN (
    'orders:read', 'inventory:read', 'analytics:read', 'events:read'
  ) THEN
    RAISE EXCEPTION 'connector_scope_denied';
  END IF;
  IF (p_resource, p_action) NOT IN (
    ('orders', 'view'), ('inventory', 'view'), ('analytics', 'view')
  ) THEN
    RAISE EXCEPTION 'connector_scope_denied';
  END IF;
  IF p_scope <> p_resource || ':read' THEN
    RAISE EXCEPTION 'connector_scope_denied';
  END IF;

  SELECT g.id, g.user_id, g.merchant_id, g.branch_ids, g.merchant_wide,
         g.scopes, g.status, g.expires_at, g.version
  INTO v_grant
  FROM public.connector_grants g
  WHERE g.token_hash = p_token_hash;

  IF NOT FOUND
    OR v_grant.status <> 'active'
    OR (v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now()) THEN
    RAISE EXCEPTION 'connector_grant_denied';
  END IF;

  -- The gateway holds no user session, so production's permission helper
  -- would see auth.uid() NULL and deny every resolve. Act as the linked
  -- user for the evaluation below: the token hash already proved
  -- possession of this grant's credential, the value derives from the
  -- validated grant row (never caller input), and EXECUTE is granted only
  -- to connector_gateway. Transaction-local: no leakage across checkouts.
  -- Reached only for active, unexpired grants with allowlisted parameters,
  -- later denials raise and roll back these local claim changes.
  PERFORM set_config('request.jwt.claim.sub', v_grant.user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_grant.user_id)::text,
    true
  );

  -- Live re-evaluation: owners pass; staff must be active with the tool's
  -- resource permission.
  IF NOT public.check_staff_permission(
    v_grant.user_id, v_grant.merchant_id, p_resource, p_action
  ) THEN
    RAISE EXCEPTION 'connector_grant_forbidden';
  END IF;

  -- Explicitly-true membership: a NULL comparison (from malformed
  -- stored data) must deny, never pass.
  IF (p_scope = ANY (v_grant.scopes)) IS NOT TRUE THEN
    RAISE EXCEPTION 'connector_scope_denied';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_grant.merchant_id AND m.user_id = v_grant.user_id
  ) INTO v_is_owner;

  IF v_grant.merchant_wide AND NOT v_is_owner THEN
    RAISE EXCEPTION 'connector_scope_denied';
  END IF;

  -- Selectors are contained by the grant allowlist (merchant-wide owner
  -- grants ignore branch selectors; the whole merchant is in scope). NULL
  -- array elements are rejected: they would otherwise slip containment.
  IF NOT v_grant.merchant_wide AND p_branch_ids IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(p_branch_ids) b WHERE b IS NULL) THEN
      RAISE EXCEPTION 'connector_branch_denied';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(p_branch_ids) b
      WHERE (b = ANY (v_grant.branch_ids)) IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'connector_branch_denied';
    END IF;
  END IF;

  RETURN QUERY
  SELECT v_grant.id, v_grant.user_id, v_grant.merchant_id,
         v_grant.branch_ids, v_grant.merchant_wide,
         v_grant.scopes, v_grant.version;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_connector_grant_context(
  text, text, text, text, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_connector_grant_context(
  text, text, text, text, uuid[]
) TO connector_gateway;


-- Source: 20261003090000_connector_gateway_audit_r1.sql
-- SHA256: 7f60bd30a9f6aa1b1aab6596b3723b6693fbebe11e0f768ed44120e2037d4c74
-- R1 read-only gateway audit sink: durable per-request records.
--
-- One row per gateway call: grant id (when resolved), route, status, and
-- latency. The table has no credential, payload, or row-data columns by
-- design; the gateway allowlist builder (tools/connector-gateway/audit.ts)
-- can only write these fields.
--
-- Write path is INSERT-only for the connector_gateway role through an RLS
-- policy. Merchant members read their own merchants' rows through the
-- grant linkage; rows without a resolved grant stay admin-visible only.

CREATE TABLE IF NOT EXISTS public.connector_gateway_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  grant_id uuid REFERENCES public.connector_grants (id) ON DELETE SET NULL,
  route text NOT NULL,
  status integer NOT NULL,
  latency_ms integer NOT NULL,
  CONSTRAINT connector_gateway_audit_route_check
    CHECK (route <> '' AND char_length(route) <= 200),
  CONSTRAINT connector_gateway_audit_status_check
    CHECK (status >= 100 AND status <= 599),
  CONSTRAINT connector_gateway_audit_latency_check
    CHECK (latency_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_connector_gateway_audit_occurred
  ON public.connector_gateway_audit (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_gateway_audit_grant
  ON public.connector_gateway_audit (grant_id, occurred_at DESC);

ALTER TABLE public.connector_gateway_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.connector_gateway_audit FROM anon, authenticated;
GRANT INSERT (grant_id, route, status, latency_ms)
  ON public.connector_gateway_audit TO connector_gateway;
GRANT SELECT (id, occurred_at, grant_id, route, status, latency_ms)
  ON public.connector_gateway_audit TO authenticated;

DROP POLICY IF EXISTS "connector_gateway_audit_insert"
  ON public.connector_gateway_audit;
CREATE POLICY "connector_gateway_audit_insert"
  ON public.connector_gateway_audit
  FOR INSERT
  TO connector_gateway
  WITH CHECK (true);

DROP POLICY IF EXISTS "connector_gateway_audit_member_select"
  ON public.connector_gateway_audit;
CREATE POLICY "connector_gateway_audit_member_select"
  ON public.connector_gateway_audit
  FOR SELECT
  TO authenticated
  USING (
    grant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.connector_grants g
      WHERE g.id = grant_id
        AND public.has_merchant_access(g.merchant_id)
    )
  );


-- Source: 20261003130000_connector_grant_owner_reissue_r1.sql
-- SHA256: 834f2cc72d637c1f2adffb0f38b5a424db018638a048499b6562369b519d660b
-- Owner-driven credential reissue for the Connect retry path (R1).
--
-- A retry carrying a stable connectionId means the first response may have
-- been lost while the grant exists. Returning metadata without tokens
-- would strand the connection; deleting and recreating would break the
-- stable id. Reissue rotates the pair in place instead: the
-- possibly-exposed credentials die and the caller receives a fresh pair
-- for the same grant. Scopes, branches, and expiry are unchanged — use
-- Disconnect + Connect to change those.
--
-- Owners only: the Connect interface is owners-only throughout, and this
-- RPC is its recovery path. Concurrent reissues are last-writer-wins;
-- the loser holds dead credentials and recovers by retrying.

CREATE OR REPLACE FUNCTION public.reissue_connector_grant_tokens(
  p_grant_id uuid,
  p_new_token_hash text,
  p_new_refresh_token_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_grant record;
BEGIN
  v_caller := (SELECT auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT merchant_id, status, expires_at INTO v_grant
  FROM public.connector_grants
  WHERE id = p_grant_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_grant.merchant_id AND m.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_new_token_hash IS NULL OR p_new_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;
  IF p_new_refresh_token_hash IS NOT NULL
    AND p_new_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;

  IF v_grant.status <> 'active'
    OR (v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now()) THEN
    RETURN false;
  END IF;

  UPDATE public.connector_grants
  SET token_hash = p_new_token_hash,
      refresh_token_hash = p_new_refresh_token_hash,
      version = version + 1,
      updated_at = now()
  WHERE id = p_grant_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_connector_grant_tokens(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reissue_connector_grant_tokens(uuid, text, text)
  TO authenticated;


-- Inventory aggregate columns; hidden identifiers remain inaccessible.
REVOKE ALL ON public.variant_inventory FROM anon, authenticated;
GRANT SELECT (id, variant_id, merchant_id, branch_id, status)
  ON public.variant_inventory TO authenticated;


-- Source: 20261003140000_connector_inventory_owner_only_r1.sql
-- SHA256: 1d75c0a6424a85844f3aa9ce4b17e20e58a78a0abd99324c74df0566ef2f6a9d
-- R1 follow-up: inventory rows are connector-readable only through an owner
-- grant. The preceding member-read migration used has_merchant_access(),
-- which includes every active staff member. Keep the column-scoped grant but
-- restrict row visibility to the merchant owner to match the owner-only
-- connector cohort and avoid broadening ordinary staff inventory access.

DROP POLICY IF EXISTS "variant_inventory_member_select"
  ON public.variant_inventory;
CREATE POLICY "variant_inventory_member_select"
  ON public.variant_inventory
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = variant_inventory.merchant_id
        AND m.user_id = (SELECT auth.uid())
    )
  );


-- Runtime activation is a separate provisioning step.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'connector_gateway'
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'connector_gateway must not have elevated role attributes';
  END IF;
END
$$;
ALTER ROLE connector_gateway NOLOGIN;
