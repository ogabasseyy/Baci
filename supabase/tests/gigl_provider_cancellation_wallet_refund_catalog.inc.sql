-- Catalog checks for gigl_provider_cancellation_wallet_refund.sql (\ir part).
-- A denied EXECUTE cannot be trapped on the replay image, so privileges are
-- asserted through the catalog, never by calling.

-- T9: the refund helper and the stamp trigger function are DEFINER with an
-- empty search_path and no API grant; the apply RPC and the worker wrapper
-- keep their grants; the trigger, the guard and the index are in place.
DO $t9$
DECLARE
  v_fn regprocedure;
  v_role text;
  v_apply text := pg_catalog.pg_get_functiondef(
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure
  );
  v_wrapper constant regprocedure :=
    'public.gigl_worker_apply_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure;
  v_guard text := pg_catalog.pg_get_functiondef(
    'private.prevent_active_gigl_shipping_cancellation()'::regprocedure
  );
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text)'::regprocedure,
    'private.stamp_booked_gigl_charge_waybill()'::regprocedure
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'gigl_tracking_worker'
    ] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn::oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'T9: % must not execute %', v_role, v_fn;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) AS acl
      WHERE p.oid = v_fn::oid AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION 'T9: PUBLIC must not execute %', v_fn;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = v_fn::oid AND p.prosecdef
        AND 'search_path=""' = ANY (p.proconfig)
    ) THEN
      RAISE EXCEPTION 'T9: % must be SECURITY DEFINER with an empty search_path', v_fn;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T9: apply_gigl_tracking_result must stay service_role-only';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_wrapper::oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_wrapper::oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_wrapper::oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('gigl_tracking_worker', v_wrapper::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'T9: the worker wrapper must stay gigl_tracking_worker-only';
  END IF;

  IF strpos(v_apply, E'  IF v_effective_status = ''cancelled'' AND p_status = ''cancelled'' THEN\n'
       || E'    PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(\n'
       || E'      p_shipment_id, p_tracking_epoch_id, v_order_id, v_current_status\n') = 0
     OR strpos(v_apply, 'PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(')
       >= strpos(v_apply, E'  UPDATE public.shipments AS shipment\n')
     OR strpos(v_apply, 'ON CONFLICT DO NOTHING') = 0
     OR strpos(v_apply, 'v_manual_terminal_failed') = 0 THEN
    RAISE EXCEPTION 'T9: apply must refund before the shipments update and keep its hardenings';
  END IF;
  IF strpos(v_guard, 'charge.status IN (''booked'', ''needs_reconciliation'')') = 0
     OR strpos(v_guard, 'active_merchant_shipping_charge') = 0
     OR strpos(v_guard, 'refund_gigl_wallet_charge_on_provider_cancellation') > 0 THEN
    RAISE EXCEPTION 'T9: the cancellation guard must be unchanged';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = 'public.merchant_shipping_charges'::regclass
      AND t.tgname = 'stamp_booked_gigl_charge_waybill'
      AND pg_catalog.pg_get_triggerdef(t.oid) =
        'CREATE TRIGGER stamp_booked_gigl_charge_waybill BEFORE UPDATE OF status'
        || ' ON public.merchant_shipping_charges FOR EACH ROW EXECUTE FUNCTION'
        || ' private.stamp_booked_gigl_charge_waybill()'
  ) THEN
    RAISE EXCEPTION 'T9: the waybill stamp must be a BEFORE UPDATE OF status row trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_class AS c ON c.oid = i.indexrelid
    WHERE c.relname = 'wallet_transactions_gigl_charge_refund_once_idx'
      AND i.indrelid = 'public.wallet_transactions'::regclass
      AND i.indisunique
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%type = ''refund''%'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%source_type = ''gigl_shipping''%'
      AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%merchant_shipping_charge_id%'
  ) THEN
    RAISE EXCEPTION 'T9: the provider-cancellation refund backstop index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_class AS c ON c.oid = i.indexrelid
    WHERE c.relname = 'merchant_shipping_charges_gigl_waybill_once_idx'
      AND i.indrelid = 'public.merchant_shipping_charges'::regclass
      AND i.indisunique
      AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(provider_reference)%'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%provider_reference IS NOT NULL%'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%booked%'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%refunded%'
  ) THEN
    RAISE EXCEPTION 'T9: one waybill must back at most one booked or refunded charge';
  END IF;
  IF strpos(
       pg_catalog.pg_get_functiondef(
         'private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text)'::regprocedure
       ),
       'FROM public.shipment_tracking_events AS history'
     ) = 0 THEN
    RAISE EXCEPTION 'T9: the refund helper must read GIG''s recorded history';
  END IF;
END;
$t9$;
