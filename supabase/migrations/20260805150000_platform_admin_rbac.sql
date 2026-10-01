-- Platform administration must not be inferred from merchant staff access.
-- Existing is_platform_admin owners remain platform owners until deliberately
-- migrated, so the change is backwards compatible and immediately fail closed
-- for every other authenticated account.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

DO $$
BEGIN
  CREATE TYPE public.platform_admin_role AS ENUM (
    'owner',
    'finance',
    'operations',
    'support',
    'content',
    'viewer'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.platform_admin_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.platform_admin_role NOT NULL,
  status text NOT NULL DEFAULT 'active',
  reason text NOT NULL,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_memberships_user_id_key UNIQUE (user_id),
  CONSTRAINT platform_admin_memberships_status_check CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT platform_admin_memberships_reason_check CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 500
  )
);

COMMENT ON TABLE public.platform_admin_memberships IS
  'Platform-level roles. This is deliberately separate from public.staff_members.';

CREATE INDEX IF NOT EXISTS idx_platform_admin_memberships_active_user
  ON public.platform_admin_memberships (user_id)
  WHERE status = 'active';

ALTER TABLE public.platform_admin_memberships ENABLE ROW LEVEL SECURITY;

-- There are intentionally no direct table policies. Context is disclosed only
-- through the small, authenticated RPC below; changes will use dedicated,
-- audited admin commands in a follow-up.
REVOKE ALL ON TABLE public.platform_admin_memberships
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.get_platform_admin_context_v1(
  p_user_id uuid
)
RETURNS TABLE (
  role text,
  permissions text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.platform_admin_role;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Legacy platform owners may own more than one merchant. EXISTS is
  -- intentional: a scalar merchant lookup would incorrectly reject them.
  IF EXISTS (
    SELECT 1
    FROM public.merchants merchant
    WHERE merchant.user_id = p_user_id
      AND merchant.is_platform_admin IS TRUE
  ) THEN
    RETURN QUERY
    SELECT
      'owner'::text,
      ARRAY[
        'platform.read',
        'analytics.read',
        'audit.read',
        'content.manage',
        'financials.read',
        'financials.manage',
        'merchants.read',
        'merchants.manage',
        'notifications.manage',
        'operations.read',
        'operations.manage',
        'roles.manage',
        'settings.read',
        'settings.manage'
      ]::text[];
    RETURN;
  END IF;

  SELECT membership.role
    INTO v_role
  FROM public.platform_admin_memberships membership
  WHERE membership.user_id = p_user_id
    AND membership.status = 'active'
    AND membership.revoked_at IS NULL
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_role::text,
    CASE v_role
      WHEN 'owner'::public.platform_admin_role THEN ARRAY[
        'platform.read',
        'analytics.read',
        'audit.read',
        'content.manage',
        'financials.read',
        'financials.manage',
        'merchants.read',
        'merchants.manage',
        'notifications.manage',
        'operations.read',
        'operations.manage',
        'roles.manage',
        'settings.read',
        'settings.manage'
      ]::text[]
      WHEN 'finance'::public.platform_admin_role THEN ARRAY[
        'platform.read',
        'analytics.read',
        'audit.read',
        'financials.read',
        'financials.manage',
        'merchants.read'
      ]::text[]
      WHEN 'operations'::public.platform_admin_role THEN ARRAY[
        'platform.read',
        'analytics.read',
        'audit.read',
        'merchants.read',
        'merchants.manage',
        'operations.read',
        'operations.manage'
      ]::text[]
      WHEN 'support'::public.platform_admin_role THEN ARRAY[
        'platform.read',
        'analytics.read',
        'merchants.read',
        'notifications.manage',
        'operations.read'
      ]::text[]
      WHEN 'content'::public.platform_admin_role THEN ARRAY[
        'platform.read',
        'content.manage',
        'notifications.manage'
      ]::text[]
      WHEN 'viewer'::public.platform_admin_role THEN ARRAY[
        'platform.read',
        'analytics.read',
        'merchants.read'
      ]::text[]
      ELSE ARRAY[]::text[]
    END;
END;
$$;

ALTER FUNCTION private.get_platform_admin_context_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.get_platform_admin_context_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_platform_admin_permission_v1(
  p_user_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.get_platform_admin_context_v1(p_user_id) AS context
    WHERE p_permission = ANY(context.permissions)
  );
$$;

ALTER FUNCTION private.has_platform_admin_permission_v1(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.has_platform_admin_permission_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_platform_admin_context_v1()
RETURNS TABLE (
  role text,
  permissions text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT context.role, context.permissions
  FROM private.get_platform_admin_context_v1((SELECT auth.uid())) AS context;
$$;

ALTER FUNCTION public.get_platform_admin_context_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_platform_admin_context_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_platform_admin_context_v1()
  TO authenticated;

COMMIT;
