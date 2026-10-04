-- Keep grant metadata owner-only even through direct authenticated REST reads.
DROP POLICY IF EXISTS connector_grants_member_select ON public.connector_grants;
CREATE POLICY connector_grants_owner_select ON public.connector_grants
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.merchants m
  WHERE m.id = connector_grants.merchant_id AND m.user_id = (SELECT auth.uid())
));

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

  -- Connector tokens must not outlive a live Auth suspension or soft deletion.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = v_grant.user_id
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'connector_user_suspended';
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

  IF NOT v_is_owner THEN
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
