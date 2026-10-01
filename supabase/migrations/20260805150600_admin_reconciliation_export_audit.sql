-- Fixed-shape audit command for financial reconciliation CSV downloads.
-- The caller cannot forge action/resource/metadata values, and finance users
-- need only financials.read rather than the generic roles.manage writer.

BEGIN;

CREATE OR REPLACE FUNCTION public.write_admin_reconciliation_export_event_v1()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
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
    'financials.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_financials_read_required'
      USING ERRCODE = '42501';
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
    'reconciliation.exported',
    'financial_reconciliation',
    'platform_reconciliation_export',
    ARRAY[]::text[],
    pg_catalog.jsonb_build_object(
      'category', 'financials',
      'operation', 'export',
      'result', 'succeeded'
    )
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

ALTER FUNCTION public.write_admin_reconciliation_export_event_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_admin_reconciliation_export_event_v1()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.write_admin_reconciliation_export_event_v1()
  TO authenticated;

COMMENT ON FUNCTION public.write_admin_reconciliation_export_event_v1() IS
  'Writes one fixed, immutable financial-reconciliation export audit event. Requires financials.read; accepts no caller-shaped event data.';

COMMIT;
