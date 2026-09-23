-- The orderless repair-pickup apply RPC reintroduced a bare column-list
-- ON CONFLICT that only matches a dropped non-partial unique constraint.
-- Rebind to bare ON CONFLICT DO NOTHING so either partial identity index
-- (milestone vs attempt) remains a safe no-op under races — same pattern as
-- 20260801141500_scope_gigl_notification_identity.sql.

DO $migration$
DECLARE
  v_original_definition text;
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure
  ) INTO v_original_definition;
  v_definition := regexp_replace(
    v_original_definition,
    E'ON CONFLICT \\(\\s*shipment_id, tracking_epoch_id, tracking_event_id, audience, notification_kind\\s*\\)\\s*DO NOTHING',
    'ON CONFLICT DO NOTHING',
    'g'
  );
  IF v_definition = v_original_definition
    OR v_definition NOT LIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION
      'GIGL tracking orderless notification conflict target hardening did not apply';
  END IF;
  EXECUTE v_definition;
END;
$migration$;
