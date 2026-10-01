-- Harden notification manager RLS and paginate the platform access roster.
BEGIN;

DROP POLICY IF EXISTS notifications_platform_insert_v2 ON public.notifications;
CREATE POLICY notifications_platform_insert_v2 ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND created_by = (SELECT auth.uid())
    AND sent_at IS NULL
    AND delivery_state = 'pending'
    AND delivery_attempts = 0
    AND (
      target_type IS DISTINCT FROM 'specific'
      OR public.current_user_has_platform_admin_permission_v1('merchants.read')
    )
  );

DROP POLICY IF EXISTS notifications_platform_update_v2 ON public.notifications;
CREATE POLICY notifications_platform_update_v2 ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND sent_at IS NULL
    AND delivery_state = 'pending'
    AND delivery_attempts = 0
  ) WITH CHECK (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND sent_at IS NULL
    AND delivery_state = 'pending'
    AND delivery_attempts = 0
    AND (
      target_type IS DISTINCT FROM 'specific'
      OR public.current_user_has_platform_admin_permission_v1('merchants.read')
    )
  );

DROP POLICY IF EXISTS notifications_platform_delete_v2 ON public.notifications;
CREATE POLICY notifications_platform_delete_v2 ON public.notifications
  FOR DELETE TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND sent_at IS NULL
    AND delivery_state = 'pending'
    AND delivery_attempts = 0
  );

DROP FUNCTION IF EXISTS public.list_platform_admin_memberships_v1(integer);
CREATE FUNCTION public.list_platform_admin_memberships_v1(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
BEGIN
  PERFORM private.assert_platform_roles_manage_v1();
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'platform_admin_membership_limit_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN
    RAISE EXCEPTION 'platform_admin_membership_offset_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH legacy_owner AS (
    SELECT merchant.user_id, min(merchant.created_at) AS granted_at
    FROM public.merchants AS merchant
    WHERE merchant.user_id IS NOT NULL AND merchant.is_platform_admin IS TRUE
    GROUP BY merchant.user_id
  ), membership AS (
    SELECT m.user_id, m.role, m.status, m.reason, m.granted_at, m.revoked_at,
      m.created_at, m.updated_at
    FROM public.platform_admin_memberships AS m
  ), effective_membership AS (
    SELECT COALESCE(lo.user_id, m.user_id) AS user_id,
      CASE WHEN lo.user_id IS NOT NULL THEN 'owner'::text ELSE m.role::text END AS role,
      CASE WHEN lo.user_id IS NOT NULL THEN 'active'::text ELSE m.status END AS status,
      CASE WHEN lo.user_id IS NOT NULL THEN 'legacy_platform_owner'::text ELSE m.reason END AS reason,
      COALESCE(lo.granted_at, m.granted_at) AS granted_at,
      CASE WHEN lo.user_id IS NOT NULL THEN NULL ELSE m.revoked_at END AS revoked_at,
      m.created_at, m.updated_at, lo.user_id IS NOT NULL AS is_legacy_owner
    FROM legacy_owner AS lo
    FULL OUTER JOIN membership AS m ON m.user_id = lo.user_id
  )
  SELECT account.email, e.role, e.status, e.reason, e.granted_at, e.revoked_at,
    e.created_at, e.updated_at, e.is_legacy_owner,
    e.status = 'active'
      AND NOT e.is_legacy_owner
      AND e.user_id IS DISTINCT FROM v_actor_user_id
      AND (e.role <> 'owner' OR private.active_platform_owner_count_v1() > 1)
  FROM effective_membership AS e
  INNER JOIN auth.users AS account ON account.id = e.user_id
  ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END, account.email ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

ALTER FUNCTION public.list_platform_admin_memberships_v1(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_platform_admin_memberships_v1(integer, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_platform_admin_memberships_v1(integer, integer)
  TO authenticated;

COMMIT;
