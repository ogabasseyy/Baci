-- Controlled platform-admin membership list and shared access helpers.
BEGIN;

CREATE OR REPLACE FUNCTION private.platform_admin_email_valid_v1(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_email IS NOT NULL
    AND char_length(btrim(p_email)) BETWEEN 3 AND 254
    AND lower(btrim(p_email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

REVOKE ALL ON FUNCTION private.platform_admin_email_valid_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.active_platform_owner_count_v1()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::bigint
  FROM (
    SELECT merchant.user_id
    FROM public.merchants AS merchant
    WHERE merchant.user_id IS NOT NULL
      AND merchant.is_platform_admin IS TRUE
    UNION
    SELECT membership.user_id
    FROM public.platform_admin_memberships AS membership
    WHERE membership.role = 'owner'::public.platform_admin_role
      AND membership.status = 'active'
      AND membership.revoked_at IS NULL
  ) AS active_owner;
$$;

ALTER FUNCTION private.active_platform_owner_count_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.active_platform_owner_count_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_platform_roles_manage_v1()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'roles.manage'
  ) THEN
    RAISE EXCEPTION 'platform_admin_roles_manage_required' USING ERRCODE = '42501';
  END IF;

  RETURN v_actor_user_id;
END;
$$;

ALTER FUNCTION private.assert_platform_roles_manage_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_platform_roles_manage_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_platform_admin_memberships_v1(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  email text,
  role text,
  status text,
  reason text,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  is_legacy_owner boolean,
  is_revocable boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_platform_roles_manage_v1();

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'platform_admin_membership_limit_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH legacy_owner AS (
    SELECT merchant.user_id, min(merchant.created_at) AS granted_at
    FROM public.merchants AS merchant
    WHERE merchant.user_id IS NOT NULL
      AND merchant.is_platform_admin IS TRUE
    GROUP BY merchant.user_id
  ), membership AS (
    SELECT platform_membership.user_id, platform_membership.role,
      platform_membership.status, platform_membership.reason,
      platform_membership.granted_at, platform_membership.revoked_at,
      platform_membership.created_at, platform_membership.updated_at
    FROM public.platform_admin_memberships AS platform_membership
  ), effective_membership AS (
    SELECT
      COALESCE(legacy_owner.user_id, membership.user_id) AS user_id,
      CASE WHEN legacy_owner.user_id IS NOT NULL THEN 'owner'::text ELSE membership.role::text END AS role,
      CASE WHEN legacy_owner.user_id IS NOT NULL THEN 'active'::text ELSE membership.status END AS status,
      CASE WHEN legacy_owner.user_id IS NOT NULL THEN 'legacy_platform_owner'::text ELSE membership.reason END AS reason,
      COALESCE(legacy_owner.granted_at, membership.granted_at) AS granted_at,
      CASE WHEN legacy_owner.user_id IS NOT NULL THEN NULL ELSE membership.revoked_at END AS revoked_at,
      membership.created_at, membership.updated_at,
      legacy_owner.user_id IS NOT NULL AS is_legacy_owner
    FROM legacy_owner
    FULL OUTER JOIN membership ON membership.user_id = legacy_owner.user_id
  )
  SELECT account.email, effective.role, effective.status, effective.reason,
    effective.granted_at, effective.revoked_at, effective.created_at,
    effective.updated_at, effective.is_legacy_owner,
    NOT effective.is_legacy_owner AND effective.status = 'active' AS is_revocable
  FROM effective_membership AS effective
  INNER JOIN auth.users AS account ON account.id = effective.user_id
  ORDER BY CASE effective.status WHEN 'active' THEN 0 ELSE 1 END, account.email ASC
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION public.list_platform_admin_memberships_v1(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_platform_admin_memberships_v1(integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_platform_admin_memberships_v1(integer)
  TO authenticated;

COMMIT;
