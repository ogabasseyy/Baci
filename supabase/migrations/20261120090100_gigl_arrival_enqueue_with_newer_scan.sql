-- 1. Queue the customer "arrived in your city" update even when a newer scan
--    shares the poll (aggregate status moves past in_transit).
-- 2. Let a backfilled older terminal scan (delivered, cancelled, returned)
--    override a newer stored progress scan, as the normalizer already does, so
--    its status, delivered_at and notification stay consistent.
--    A newer stored SDR still fences an older backfilled terminal scan (the
--    normalizer's rule), and a backfilled delivery records delivered_at.
--    Intended for all three terminal kinds: they outrank failed and progress
--    scans in the canonical rank (failed 5, delivered 6, cancelled/returned 7),
--    so an older cancelled also beats a newer failed or out_for_delivery.
-- Dedup contract the arrival relies on (not changed here): unique index
-- shipment_tracking_notifications_milestone_identity_key (20260801141500) keeps
-- each kind to once per shipment, and trigger
-- suppress_late_gigl_tracking_notifications (20260801130700) drops an older
-- pending customer update when a newer one is queued in the same statement.
-- In-place patch of
-- the LIVE apply function (20261102053320 pattern), so the 20260904190550,
-- 20260905140000 and 20261102053320 changes survive; CREATE OR REPLACE keeps
-- the owner and grants. Any drift in the anchor fails this migration loudly.
DO $migration$
DECLARE
  v_fn constant regprocedure :=
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure;
  v_anchor constant text :=
    E'      AND event.normalized_status = v_effective_status\n';
  v_replacement constant text :=
    E'      AND (\n'
    || E'        event.normalized_status = v_effective_status\n'
    || E'        OR (\n'
    || E'          upper(event.raw_status) = ''ARRIVED IN DESTINATION CITY''\n'
    || E'          AND event.normalized_status = ''in_transit''\n'
    || E'          AND v_effective_status IN (''in_transit'', ''out_for_delivery'')\n'
    || E'        )\n'
    || E'      )\n';
  v_anchor2 constant text :=
    E'    WHEN v_current_status IS NOT NULL\n'
    || E'      AND v_latest_persisted_event_at IS NOT NULL\n'
    || E'      AND v_latest_status_event_at IS NOT NULL\n'
    || E'      AND v_latest_status_event_at < v_latest_persisted_status_event_at\n'
    || E'      THEN v_current_status\n';
  v_replacement2 constant text :=
    E'    WHEN p_status IN (''delivered'', ''cancelled'', ''returned'')\n'
    || E'      AND v_current_status IS NOT NULL\n'
    || E'      AND v_current_status NOT IN (''delivered'', ''cancelled'', ''returned'')\n'
    || E'      AND NOT EXISTS (\n'
    || E'        SELECT 1\n'
    || E'        FROM jsonb_array_elements(\n'
    || E'          coalesce(v_existing_tracking_events, ''[]''::jsonb)\n'
    || E'        ) AS sdr(event)\n'
    || E'        WHERE upper(coalesce(sdr.event->>''raw_status'', sdr.event->>''rawStatus'', '''')) = ''SDR''\n'
    || E'          AND private.try_parse_gigl_tracking_timestamp(\n'
    || E'            coalesce(sdr.event->>''occurred_at'', sdr.event->>''timestamp'')\n'
    || E'          ) > coalesce(v_latest_status_event_at, ''-infinity''::timestamptz)\n'
    || E'      )\n'
    || E'      AND NOT EXISTS (\n'
    || E'        SELECT 1 FROM public.shipment_tracking_events AS stored_sdr\n'
    || E'        WHERE stored_sdr.shipment_id = p_shipment_id\n'
    || E'          AND stored_sdr.tracking_epoch_id = p_tracking_epoch_id\n'
    || E'          AND upper(stored_sdr.raw_status) = ''SDR''\n'
    || E'          AND stored_sdr.occurred_at\n'
    || E'            > coalesce(v_latest_status_event_at, ''-infinity''::timestamptz)\n'
    || E'      )\n'
    || E'      THEN p_status\n'
    || v_anchor2;
  v_anchor3 constant text :=
    E'      v_latest_persisted_event_at IS NULL\n'
    || E'      OR v_latest_incoming_event_at IS NULL\n'
    || E'      OR v_latest_incoming_event_at >= v_latest_persisted_event_at\n'
    || E'    );\n';
  v_replacement3 constant text :=
    E'      v_latest_persisted_event_at IS NULL\n'
    || E'      OR v_latest_incoming_event_at IS NULL\n'
    || E'      OR v_latest_incoming_event_at >= v_latest_persisted_event_at\n'
    || E'      OR v_effective_status = ''delivered''\n'
    || E'    );\n';
  v_original text;
  v_patched text;
BEGIN
  v_original := pg_catalog.pg_get_functiondef(v_fn);
  IF strpos(v_original, 'ARRIVED IN DESTINATION CITY') > 0 THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result already queues the arrival';
  END IF;
  IF length(v_original) - length(replace(v_original, v_anchor, ''))
     <> length(v_anchor) THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result anchor must occur exactly once';
  END IF;
  IF length(v_original) - length(replace(v_original, v_anchor2, ''))
     <> length(v_anchor2) THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result terminal anchor must occur exactly once';
  END IF;
  IF length(v_original) - length(replace(v_original, v_anchor3, ''))
     <> length(v_anchor3) THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result delivery anchor must occur exactly once';
  END IF;
  v_patched := replace(
    replace(
      replace(v_original, v_anchor, v_replacement), v_anchor2, v_replacement2
    ),
    v_anchor3, v_replacement3
  );
  IF v_patched = v_original THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result patch changed nothing';
  END IF;
  EXECUTE v_patched;
END;
$migration$;

DO $assert$
DECLARE
  v_apply constant text :=
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)';
  v_def text := pg_catalog.pg_get_functiondef(v_apply::regprocedure);
BEGIN
  IF strpos(v_def, 'ARRIVED IN DESTINATION CITY') = 0
     OR strpos(v_def, 'ON CONFLICT DO NOTHING') = 0
     OR strpos(v_def, 'refund_gigl_wallet_charge_on_provider_cancellation') = 0 THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result lost a prior hardening';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_apply, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_apply, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_apply, 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result privileges drifted';
  END IF;
END;
$assert$;
