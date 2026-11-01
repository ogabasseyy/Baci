SELECT private.release_stale_offer_line_serialized_units('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','{}');
DO $$ DECLARE data jsonb; BEGIN
 SELECT fulfillment_data INTO data FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000001';
 IF data->'inventoryUnits' IS DISTINCT FROM '[{"inventoryUnitId":"00000000-0000-0000-0000-000000000003","identifierValue":"sold"}]'::jsonb OR data->>'refundReference' IS DISTINCT FROM 'keep' THEN
  RAISE EXCEPTION 'mixed snapshot must retain only the sold unit and unrelated fields';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000002' AND status='available' AND order_item_id IS NULL) THEN
  RAISE EXCEPTION 'reserved unit must be released';
 END IF;
END $$;

SELECT private.release_stale_offer_line_serialized_units('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000005','{}');
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM private.legacy_offer_cleanup_reservations WHERE order_item_id='00000000-0000-0000-0000-000000000011')
  OR private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000011') IS DISTINCT FROM false
  OR private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'cleanup evidence must change routing only when no units remain attached';
 END IF;
END $$;
