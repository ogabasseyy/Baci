-- Wires the provider-cancellation refund (20261102053310) into the trusted
-- GIGL tracking apply path (design in 20261102053300). Only a cancellation
-- the apply is about to persist calls the helper, before the shipments
-- update, so its refund lands before the unchanged guard checks for an
-- active charge; the helper receives this call's p_events to read the
-- worker's account attestation.

-- 1. In-place patch of the LIVE apply function (20260905140000 pattern), so
--    the 20260904190550 and 20260905140000 hardenings survive. CREATE OR
--    REPLACE keeps the owner and the postgres/service_role-only grants. The
--    anchor was re-verified against production's pg_get_functiondef on
--    2026-11-02; any drift fails this migration loudly.
DO $migration$
DECLARE
  v_fn constant regprocedure :=
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure;
  v_anchor constant text :=
    E'  SELECT count(*) INTO v_inserted_events FROM inserted_events;\n'
    || E'  UPDATE public.shipments AS shipment\n';
  v_replacement constant text :=
    E'  SELECT count(*) INTO v_inserted_events FROM inserted_events;\n'
    || E'  IF v_effective_status = ''cancelled'' AND p_status = ''cancelled'' THEN\n'
    || E'    PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(\n'
    || E'      p_shipment_id, p_tracking_epoch_id, v_order_id, v_current_status,\n'
    || E'      p_events\n'
    || E'    );\n'
    || E'  END IF;\n'
    || E'  UPDATE public.shipments AS shipment\n';
  v_original text;
  v_patched text;
BEGIN
  v_original := pg_catalog.pg_get_functiondef(v_fn);
  IF strpos(v_original, 'refund_gigl_wallet_charge_on_provider_cancellation') > 0 THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result already refunds provider cancellations';
  END IF;
  IF length(v_original) - length(replace(v_original, v_anchor, ''))
     <> length(v_anchor) THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result anchor must occur exactly once';
  END IF;
  v_patched := replace(v_original, v_anchor, v_replacement);
  IF v_patched = v_original
     OR strpos(v_patched, 'PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(') = 0
     OR strpos(v_patched, 'PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(')
       >= strpos(v_patched, E'  UPDATE public.shipments AS shipment\n') THEN
    RAISE EXCEPTION 'provider-cancellation refund must precede the shipments update';
  END IF;
  EXECUTE v_patched;
END;
$migration$;

-- 2. Catalog assertions (a denied EXECUTE cannot be trapped on the replay
--    image, so privileges are checked in the catalog, never by calling).
DO $assert$
DECLARE
  v_helper constant text :=
    'private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text, jsonb)';
  v_stamp constant text := 'private.stamp_booked_gigl_charge_waybill()';
  v_apply constant text :=
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)';
  v_fn text;
  v_role text;
BEGIN
  IF pg_catalog.to_regprocedure(
       'private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'the unattested provider-cancellation helper must not exist';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[v_helper, v_stamp] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = v_fn::regprocedure AND p.prosecdef
        AND 'search_path=""' = ANY (p.proconfig)
    ) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER with an empty search_path', v_fn;
    END IF;
    FOREACH v_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'gigl_tracking_worker'
    ] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not execute %', v_role, v_fn;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid IN (v_helper::regprocedure, v_stamp::regprocedure)
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute provider-cancellation helpers';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_apply, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_apply, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_apply, 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result privileges drifted';
  END IF;
  IF strpos(
       pg_catalog.pg_get_functiondef(v_apply::regprocedure),
       E'v_order_id, v_current_status,\n      p_events\n'
     ) = 0 THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result must pass p_events to the refund helper';
  END IF;
END;
$assert$;
