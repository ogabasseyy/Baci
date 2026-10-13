-- Controlled platform-admin membership grants, updates, and reactivations.
BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_platform_admin_membership_v1(
  p_email text,
  p_role public.platform_admin_role,
  p_reason text,
  p_confirmed boolean,
  p_reactivate boolean DEFAULT false
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
  v_owner_count bigint;
  v_result public.platform_admin_memberships%ROWTYPE;
BEGIN
  v_actor_user_id := private.assert_platform_roles_manage_v1();

  IF p_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'platform_admin_membership_confirmation_required' USING ERRCODE = '22023';
  END IF;
  IF NOT private.platform_admin_email_valid_v1(p_email) THEN
    RAISE EXCEPTION 'platform_admin_membership_email_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL THEN
    RAISE EXCEPTION 'platform_admin_membership_role_invalid' USING ERRCODE = '22023';
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

  -- Legacy owners remain managed by the merchant flag until a dedicated,
  -- auditable bridge-removal migration is approved.
  IF EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.user_id = v_target_user_id
      AND merchant.is_platform_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'legacy_platform_owner_cannot_be_managed_here' USING ERRCODE = '22023';
  END IF;

  -- Serialize the read-then-insert path as well as owner changes. Without
  -- taking this lock before the lookup, concurrent grants for the same new
  -- account can both observe no membership and race into the unique key.
  PERFORM pg_catalog.pg_advisory_xact_lock(185150700);

  SELECT membership.id, membership.user_id, membership.role, membership.status,
    membership.reason, membership.granted_by, membership.granted_at,
    membership.revoked_at, membership.revoked_by, membership.created_at,
    membership.updated_at
  INTO v_membership
  FROM public.platform_admin_memberships AS membership
  WHERE membership.user_id = v_target_user_id
  FOR UPDATE;

  IF v_target_user_id = v_actor_user_id
     AND p_role <> 'owner'::public.platform_admin_role THEN
    RAISE EXCEPTION 'platform_admin_self_lockout_prevented' USING ERRCODE = '42501';
  END IF;

  IF v_membership.id IS NOT NULL THEN
    IF v_membership.status = 'revoked' THEN
      IF p_reactivate IS NOT TRUE THEN
        RAISE EXCEPTION 'platform_admin_membership_reactivation_must_be_explicit'
          USING ERRCODE = '22023';
      END IF;

      UPDATE public.platform_admin_memberships AS membership
      SET
        role = p_role,
        status = 'active',
        reason = btrim(p_reason),
        granted_by = v_actor_user_id,
        granted_at = pg_catalog.clock_timestamp(),
        revoked_at = NULL,
        revoked_by = NULL,
        updated_at = pg_catalog.clock_timestamp()
      WHERE membership.id = v_membership.id
      RETURNING membership.id, membership.user_id, membership.role,
        membership.status, membership.reason, membership.granted_by,
        membership.granted_at, membership.revoked_at, membership.revoked_by,
        membership.created_at, membership.updated_at
      INTO v_result;
    ELSE
      IF p_reactivate IS TRUE THEN
        RAISE EXCEPTION 'platform_admin_membership_is_already_active'
          USING ERRCODE = '22023';
      END IF;

      IF v_membership.role = 'owner'::public.platform_admin_role
         AND p_role <> 'owner'::public.platform_admin_role THEN
        v_owner_count := private.active_platform_owner_count_v1();
        IF v_owner_count <= 1 THEN
          RAISE EXCEPTION 'platform_admin_final_owner_protected' USING ERRCODE = '42501';
        END IF;
      END IF;

      UPDATE public.platform_admin_memberships AS membership
      SET role = p_role, reason = btrim(p_reason),
        updated_at = pg_catalog.clock_timestamp()
      WHERE membership.id = v_membership.id
      RETURNING membership.id, membership.user_id, membership.role,
        membership.status, membership.reason, membership.granted_by,
        membership.granted_at, membership.revoked_at, membership.revoked_by,
        membership.created_at, membership.updated_at
      INTO v_result;
    END IF;
  ELSE
    IF p_reactivate IS TRUE THEN
      RAISE EXCEPTION 'platform_admin_membership_not_revoked' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.platform_admin_memberships AS membership (
      user_id, role, reason, granted_by, granted_at
    ) VALUES (
      v_target_user_id, p_role, btrim(p_reason), v_actor_user_id,
      pg_catalog.clock_timestamp()
    )
    RETURNING membership.id, membership.user_id, membership.role,
      membership.status, membership.reason, membership.granted_by,
      membership.granted_at, membership.revoked_at, membership.revoked_by,
      membership.created_at, membership.updated_at
    INTO v_result;
  END IF;

  INSERT INTO public.platform_audit_events (
    actor_user_id, action, resource_type, resource_id, changed_fields, metadata
  ) VALUES (
    v_actor_user_id,
    'platform_admin_membership.upserted',
    'platform_admin_membership',
    v_result.id::text,
    CASE
      WHEN v_membership.id IS NULL THEN ARRAY['role', 'reason', 'status', 'granted_at']::text[]
      WHEN v_membership.status = 'revoked' THEN ARRAY['role', 'reason', 'status', 'granted_at', 'granted_by', 'revoked_at']::text[]
      ELSE ARRAY['role', 'reason']::text[]
    END,
    pg_catalog.jsonb_build_object(
      'category', 'access',
      'operation', CASE WHEN p_reactivate THEN 'reactivate' ELSE 'upsert' END,
      'reason_code', 'operator_supplied',
      'result', 'succeeded'
    )
  );

  RETURN QUERY
  SELECT v_target_email, v_result.role::text, v_result.status, v_result.reason,
    v_result.granted_at, v_result.revoked_at, v_result.created_at,
    v_result.updated_at, false, v_result.status = 'active';
END;
$$;

ALTER FUNCTION public.upsert_platform_admin_membership_v1(
  text, public.platform_admin_role, text, boolean, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_platform_admin_membership_v1(
  text, public.platform_admin_role, text, boolean, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_platform_admin_membership_v1(
  text, public.platform_admin_role, text, boolean, boolean
) TO authenticated;

COMMIT;
