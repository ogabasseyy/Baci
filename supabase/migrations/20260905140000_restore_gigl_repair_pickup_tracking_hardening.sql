-- Restore GIGL tracking hardenings dropped by the orderless apply rewrite,
-- without recreating the RPC (keeps later conflict-target and grant state).

DO $migration$
DECLARE
  v_original_definition text;
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure
  ) INTO v_original_definition;

  v_definition := replace(
    v_original_definition,
    E'  v_should_update_delivery boolean := false;\n  v_inserted_events integer := 0;',
    E'  v_should_update_delivery boolean := false;\n'
      || E'  v_manual_terminal_failed boolean := false;\n'
      || E'  v_inserted_events integer := 0;'
  );

  v_definition := replace(
    v_definition,
    E'    WHEN private.gigl_tracking_status_rank(p_status)\n'
      || E'      < private.gigl_tracking_status_rank(coalesce(v_current_status, ''pending''))\n'
      || E'      THEN v_current_status',
    E'    WHEN v_current_status = ''failed''\n'
      || E'      AND p_status IN (''picked_up'', ''in_transit'', ''out_for_delivery'')\n'
      || E'      AND v_latest_status_event_at IS NOT NULL\n'
      || E'      AND (\n'
      || E'        v_latest_persisted_status_event_at IS NULL\n'
      || E'        OR v_latest_status_event_at >= v_latest_persisted_status_event_at\n'
      || E'      )\n'
      || E'      THEN p_status\n'
      || E'    WHEN private.gigl_tracking_status_rank(p_status)\n'
      || E'      < private.gigl_tracking_status_rank(coalesce(v_current_status, ''pending''))\n'
      || E'      THEN v_current_status'
  );

  v_definition := replace(
    v_definition,
    E'  v_should_update_delivery := p_actual_delivery IS NOT NULL',
    E'  v_should_update_delivery := v_effective_status = ''delivered''\n'
      || E'    AND p_actual_delivery IS NOT NULL'
  );

  v_definition := replace(
    v_definition,
    E'  UPDATE public.shipment_tracking_monitors AS monitor\n'
      || E'  SET state = CASE WHEN v_effective_status IN (''delivered'', ''cancelled'', ''returned'')',
    E'  v_manual_terminal_failed := v_effective_status = ''failed''\n'
      || E'    AND v_manual_terminal_override_at IS NOT NULL\n'
      || E'    AND (\n'
      || E'      v_latest_status_event_at IS NULL\n'
      || E'      OR v_latest_status_event_at <= v_manual_terminal_override_at\n'
      || E'    );\n'
      || E'  UPDATE public.shipment_tracking_monitors AS monitor\n'
      || E'  SET state = CASE WHEN (v_effective_status IN (''delivered'', ''cancelled'', ''returned'')\n'
      || E'      OR v_manual_terminal_failed)'
  );

  v_definition := replace(
    v_definition,
    E'next_poll_at = CASE WHEN v_effective_status IN (''delivered'', ''cancelled'', ''returned'')',
    E'next_poll_at = CASE WHEN (v_effective_status IN (''delivered'', ''cancelled'', ''returned'')\n'
      || E'      OR v_manual_terminal_failed)'
  );
  v_definition := replace(
    v_definition,
    E'stopped_at = CASE WHEN v_effective_status IN (''delivered'', ''cancelled'', ''returned'')',
    E'stopped_at = CASE WHEN (v_effective_status IN (''delivered'', ''cancelled'', ''returned'')\n'
      || E'      OR v_manual_terminal_failed)'
  );

  v_definition := replace(
    v_definition,
    E'ON CONFLICT (\n'
      || E'      shipment_id, tracking_epoch_id, tracking_event_id, audience, notification_kind\n'
      || E'    )\n'
      || E'      DO NOTHING',
    'ON CONFLICT DO NOTHING'
  );
  v_definition := regexp_replace(
    v_definition,
    E'ON CONFLICT \\(\\s*shipment_id, tracking_epoch_id, tracking_event_id, audience, notification_kind\\s*\\)\\s*DO NOTHING',
    'ON CONFLICT DO NOTHING',
    'g'
  );

  v_definition := replace(
    v_definition,
    E'      AND v_latest_incoming_event_at <= v_manual_terminal_override_at',
    E'      AND v_latest_status_event_at <= v_manual_terminal_override_at'
  );
  v_definition := replace(
    v_definition,
    E'        AND v_latest_incoming_event_at > v_manual_terminal_override_at',
    E'        AND v_latest_status_event_at > v_manual_terminal_override_at'
  );
  v_definition := replace(
    v_definition,
    E'      v_latest_incoming_event_at IS NULL\n'
      || E'      OR v_latest_incoming_event_at <= v_manual_terminal_override_at',
    E'      v_latest_status_event_at IS NULL\n'
      || E'      OR v_latest_status_event_at <= v_manual_terminal_override_at'
  );

  IF v_definition = v_original_definition
    OR v_definition NOT LIKE '%v_current_status = ''failed''%'
    OR v_definition NOT LIKE '%v_effective_status = ''delivered''%'
    OR v_definition NOT LIKE '%v_manual_terminal_failed%'
    OR v_definition NOT LIKE '%ON CONFLICT DO NOTHING%'
    OR v_definition LIKE '%tracking_event_id, audience, notification_kind%'
    OR v_definition LIKE
      '%OR v_latest_incoming_event_at <= v_manual_terminal_override_at%'
    OR v_definition LIKE
      '%AND v_latest_incoming_event_at > v_manual_terminal_override_at%'
  THEN
    RAISE EXCEPTION
      'GIGL repair-pickup tracking hardening did not apply';
  END IF;
  EXECUTE v_definition;
END;
$migration$;
