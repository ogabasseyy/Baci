-- Controlled platform-admin membership revocation.
BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_platform_admin_membership_v1(
  p_email text,
  p_reason text,
  p_confirmed boolean
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
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_target_user_id uuid;
  v_target_email text;
  v_membership public.platform_admin_memberships%ROWTYPE;
  v_result public.platform_admin_memberships%ROWTYPE;
  v_owner_count bigint;
BEGIN
  v_actor_user_id := private.assert_platform_roles_manage_v1();

  IF p_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'platform_admin_membership_confirmation_required' USING ERRCODE = '22023';
  END IF;
  IF NOT private.platform_admin_email_valid_v1(p_email) THEN
    RAISE EXCEPTION 'platform_admin_membership_email_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'platform_admin_membership_reason_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT account.id, account.email INTO v_target_user_id, v_target_email
  FROM auth.users AS account
  WHERE lower(account.email) = lower(btrim(p_email))
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'platform_admin_membership_account_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_user_id = v_actor_user_id THEN
    RAISE EXCEPTION 'platform_admin_self_lockout_prevented' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.user_id = v_target_user_id
      AND merchant.is_platform_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'legacy_platform_owner_cannot_be_revoked_here' USING ERRCODE = '22023';
  END IF;

  -- Match the grant/update lock order: serialize owner-count decisions before
  -- taking a membership row lock, preventing grant/revoke deadlocks.
  PERFORM pg_catalog.pg_advisory_xact_lock(185150700);

  SELECT membership.id, membership.user_id, membership.role, membership.status,
    membership.reason, membership.granted_by, membership.granted_at,
    membership.revoked_at, membership.revoked_by, membership.created_at,
    membership.updated_at
  INTO v_membership
  FROM public.platform_admin_memberships AS membership
  WHERE membership.user_id = v_target_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_membership.status <> 'active' OR v_membership.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'platform_admin_membership_not_active' USING ERRCODE = '22023';
  END IF;

  IF v_membership.role = 'owner'::public.platform_admin_role THEN
    v_owner_count := private.active_platform_owner_count_v1();
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'platform_admin_final_owner_protected' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.platform_admin_memberships AS membership
  SET
    status = 'revoked',
    reason = btrim(p_reason),
    revoked_at = pg_catalog.clock_timestamp(),
    revoked_by = v_actor_user_id,
    updated_at = pg_catalog.clock_timestamp()
  WHERE membership.id = v_membership.id
  RETURNING membership.id, membership.user_id, membership.role,
    membership.status, membership.reason, membership.granted_by,
    membership.granted_at, membership.revoked_at, membership.revoked_by,
    membership.created_at, membership.updated_at
  INTO v_result;

  INSERT INTO public.platform_audit_events (
    actor_user_id, action, resource_type, resource_id, changed_fields, metadata
  ) VALUES (
    v_actor_user_id,
    'platform_admin_membership.revoked',
    'platform_admin_membership',
    v_result.id::text,
    ARRAY['status', 'reason', 'revoked_at', 'revoked_by']::text[],
    pg_catalog.jsonb_build_object(
      'category', 'access',
      'operation', 'revoke',
      'reason_code', 'operator_supplied',
      'result', 'succeeded'
    )
  );

  RETURN QUERY
  SELECT v_target_email, v_result.role::text, v_result.status, v_result.reason,
    v_result.granted_at, v_result.revoked_at, v_result.created_at,
    v_result.updated_at, false, false;
END;
$$;

ALTER FUNCTION public.revoke_platform_admin_membership_v1(
  text, text, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_platform_admin_membership_v1(
  text, text, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_platform_admin_membership_v1(
  text, text, boolean
) TO authenticated;

COMMIT;
