-- Immutable write capabilities for the platform-wide operator audit ledger.
-- The ledger table and its validation functions are created in the preceding
-- 20260805150300_platform_audit_events migration.

BEGIN;

CREATE OR REPLACE FUNCTION private.reject_platform_audit_event_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events_are_immutable' USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_platform_audit_event_mutation_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER reject_platform_audit_event_mutation_v1
  BEFORE UPDATE OR DELETE ON public.platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_platform_audit_event_mutation_v1();

-- The only caller-shaped write entry point. It derives the actor from auth.uid()
-- and requires roles.manage, so lower-privilege roles cannot forge entries.
CREATE OR REPLACE FUNCTION public.write_platform_audit_event_v1(
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_changed_fields text[] DEFAULT ARRAY[]::text[],
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_event_id uuid;
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

  INSERT INTO public.platform_audit_events (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    changed_fields,
    metadata
  ) VALUES (
    v_actor_user_id,
    p_action,
    p_resource_type,
    p_resource_id,
    COALESCE(p_changed_fields, ARRAY[]::text[]),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_platform_audit_event_v1(
  text, text, text, text[], jsonb
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.write_platform_audit_event_v1(
  text, text, text, text[], jsonb
) TO authenticated;

-- Finance and Operations can record an export under audit.read, but receive no
-- caller-shaped writer. This event shape is deliberately fixed in SQL.
CREATE OR REPLACE FUNCTION public.write_platform_audit_export_event_v1()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_event_id uuid;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'audit.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_audit_read_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.platform_audit_events (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    changed_fields,
    metadata
  ) VALUES (
    v_actor_user_id,
    'audit.exported',
    'audit_timeline',
    'platform_audit_timeline',
    ARRAY[]::text[],
    pg_catalog.jsonb_build_object(
      'category', 'audit',
      'operation', 'export',
      'result', 'succeeded'
    )
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_platform_audit_export_event_v1()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.write_platform_audit_export_event_v1()
  TO authenticated;

COMMIT;
