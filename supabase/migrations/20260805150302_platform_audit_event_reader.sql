-- Privacy-safe, cross-tenant reader for the Admin Audit page. The table and
-- immutable writer capabilities are established by the preceding migrations.

BEGIN;

-- This reader never returns actor IDs, resource IDs, before/after JSON, request
-- metadata, IPs, user agents, or values from the legacy audit_logs table.
CREATE OR REPLACE FUNCTION public.list_platform_audit_events_v1(
  p_limit integer DEFAULT 50,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_event_source text DEFAULT NULL,
  p_before_event_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_resource_type text DEFAULT NULL
)
RETURNS TABLE (
  occurred_at timestamptz,
  event_source text,
  event_id uuid,
  actor_kind text,
  action text,
  resource_type text,
  changed_fields text[]
)
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
    'audit.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_audit_read_required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'platform_audit_limit_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (
      p_before_occurred_at IS NULL
      AND p_before_event_source IS NULL
      AND p_before_event_id IS NULL
    )
    OR (
      p_before_occurred_at IS NOT NULL
      AND p_before_event_source IS NOT NULL
      AND p_before_event_id IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'platform_audit_cursor_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_before_event_source IS NOT NULL
     AND p_before_event_source NOT IN ('canonical', 'platform') THEN
    RAISE EXCEPTION 'platform_audit_cursor_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('canonical', 'platform') THEN
    RAISE EXCEPTION 'platform_audit_source_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_action IS NOT NULL
     AND NOT private.platform_audit_token_valid_v1(p_action, 100) THEN
    RAISE EXCEPTION 'platform_audit_action_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_resource_type IS NOT NULL
     AND NOT private.platform_audit_token_valid_v1(p_resource_type, 80) THEN
    RAISE EXCEPTION 'platform_audit_resource_type_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH safe_events AS (
    SELECT
      event.occurred_at,
      'canonical'::text AS event_source,
      event.id AS event_id,
      CASE event.actor_type
        WHEN 'system' THEN 'System'
        WHEN 'service' THEN 'Service'
        ELSE 'User'
      END::text AS actor_kind,
      event.action,
      event.resource_type,
      event.changed_fields
    FROM public.audit_events AS event
    WHERE (p_source IS NULL OR p_source = 'canonical')
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_resource_type IS NULL OR event.resource_type = p_resource_type)

    UNION ALL

    SELECT
      event.occurred_at,
      'platform'::text AS event_source,
      event.id AS event_id,
      'Platform admin'::text AS actor_kind,
      event.action,
      event.resource_type,
      event.changed_fields
    FROM public.platform_audit_events AS event
    WHERE (p_source IS NULL OR p_source = 'platform')
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_resource_type IS NULL OR event.resource_type = p_resource_type)
  )
  SELECT
    event.occurred_at,
    event.event_source,
    event.event_id,
    event.actor_kind,
    event.action,
    event.resource_type,
    event.changed_fields
  FROM safe_events AS event
  WHERE p_before_occurred_at IS NULL
    OR event.occurred_at < p_before_occurred_at
    OR (
      event.occurred_at = p_before_occurred_at
      AND event.event_source < p_before_event_source
    )
    OR (
      event.occurred_at = p_before_occurred_at
      AND event.event_source = p_before_event_source
      AND event.event_id < p_before_event_id
    )
  ORDER BY event.occurred_at DESC, event.event_source DESC, event.event_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_audit_events_v1(
  integer, timestamptz, text, uuid, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_platform_audit_events_v1(
  integer, timestamptz, text, uuid, text, text, text
) TO authenticated;

COMMIT;
