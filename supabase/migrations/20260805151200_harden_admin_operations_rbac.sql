-- Align the legacy event-pipeline operator surface with membership RBAC.
-- Read-only support users may inspect incidents, while only operations
-- managers can use the fixed, audited replay entry points below.

BEGIN;

CREATE OR REPLACE FUNCTION eventing.is_event_pipeline_operator_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((SELECT auth.role()), '') = 'service_role'
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND private.has_platform_admin_permission_v1(
        (SELECT auth.uid()),
        'operations.read'
      )
    );
$$;

ALTER FUNCTION eventing.is_event_pipeline_operator_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION eventing.is_event_pipeline_operator_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- The legacy replay functions accept a caller-supplied actor and use the
-- read-oriented operator helper. Keep them for trusted workers only.
REVOKE EXECUTE ON FUNCTION public.replay_ingress_dead_letter_v1(
  uuid, uuid, text
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.replay_event_delivery_v1(
  uuid, uuid, text
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.replay_event_deliveries_batch_v1(
  uuid[], uuid, text
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.select_event_pipeline_replay_ids_v1(
  text, text, text, uuid, timestamptz, timestamptz
) FROM authenticated;

CREATE OR REPLACE FUNCTION public.select_event_pipeline_replay_ids_admin_v2(
  p_status text,
  p_destination text,
  p_error_code text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'operations.manage'
  ) THEN
    RAISE EXCEPTION 'platform_admin_operations_manage_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.select_event_pipeline_replay_ids_v1(
    p_status,
    p_destination,
    p_error_code,
    p_merchant_id,
    p_from,
    p_to
  );
END;
$$;

ALTER FUNCTION public.select_event_pipeline_replay_ids_admin_v2(
  text, text, text, uuid, timestamptz, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.select_event_pipeline_replay_ids_admin_v2(
  text, text, text, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.select_event_pipeline_replay_ids_admin_v2(
  text, text, text, uuid, timestamptz, timestamptz
) TO authenticated;

CREATE OR REPLACE FUNCTION public.replay_ingress_dead_letter_admin_v2(
  p_failure_id uuid,
  p_replay_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'operations.manage'
  ) THEN
    RAISE EXCEPTION 'platform_admin_operations_manage_required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.replay_ingress_dead_letter_v1(
    p_failure_id,
    v_actor_user_id,
    p_replay_reason
  );

  INSERT INTO public.platform_audit_events (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    changed_fields,
    metadata
  ) VALUES (
    v_actor_user_id,
    'event_pipeline.ingress_replayed',
    'event_pipeline_ingress',
    p_failure_id::text,
    ARRAY['status', 'replay_count']::text[],
    pg_catalog.jsonb_build_object(
      'category', 'operations',
      'operation', 'replay',
      'result', 'succeeded'
    )
  );

  RETURN 1;
END;
$$;

ALTER FUNCTION public.replay_ingress_dead_letter_admin_v2(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replay_ingress_dead_letter_admin_v2(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replay_ingress_dead_letter_admin_v2(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.replay_event_deliveries_batch_admin_v2(
  p_delivery_ids uuid[],
  p_replay_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '15s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_replayed integer;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'operations.manage'
  ) THEN
    RAISE EXCEPTION 'platform_admin_operations_manage_required'
      USING ERRCODE = '42501';
  END IF;

  v_replayed := public.replay_event_deliveries_batch_v1(
    p_delivery_ids,
    v_actor_user_id,
    p_replay_reason
  );

  IF v_replayed > 0 THEN
    INSERT INTO public.platform_audit_events (
      actor_user_id,
      action,
      resource_type,
      resource_id,
      changed_fields,
      metadata
    ) VALUES (
      v_actor_user_id,
      'event_pipeline.delivery_batch_replayed',
      'event_pipeline_delivery_batch',
      'event_delivery_batch',
      ARRAY['status', 'replay_count']::text[],
      pg_catalog.jsonb_build_object(
        'category', 'operations',
        'operation', 'replay',
        'result', 'succeeded'
      )
    );
  END IF;

  RETURN v_replayed;
END;
$$;

ALTER FUNCTION public.replay_event_deliveries_batch_admin_v2(uuid[], text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replay_event_deliveries_batch_admin_v2(uuid[], text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replay_event_deliveries_batch_admin_v2(
  uuid[], text
) TO authenticated;

-- This read model is user-session only; background workers have no use for it.
REVOKE EXECUTE ON FUNCTION public.get_admin_operations_v1(
  text, integer, integer
) FROM service_role;

COMMENT ON FUNCTION public.select_event_pipeline_replay_ids_admin_v2(
  text, text, text, uuid, timestamptz, timestamptz
) IS 'Operations-manager-only bounded replay selection. Actor is derived from auth.uid().';
COMMENT ON FUNCTION public.replay_ingress_dead_letter_admin_v2(uuid, text)
  IS 'Operations-manager-only ingress replay with a fixed privacy-safe platform audit event.';
COMMENT ON FUNCTION public.replay_event_deliveries_batch_admin_v2(uuid[], text)
  IS 'Operations-manager-only delivery replay with a fixed privacy-safe platform audit event.';

COMMIT;
