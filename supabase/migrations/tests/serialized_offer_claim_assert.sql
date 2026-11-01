DO $$ BEGIN
 PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'::uuid THEN
  RAISE EXCEPTION 'wrong condition unit reserved';
 END IF;
END $$;
-- Offer deletion clears the live IDs, but the immutable snapshot lets an
-- already reserved unit survive a replay.
UPDATE public.order_items SET product_offer_id=NULL, offer_id=NULL WHERE id='00000000-0000-0000-0000-000000000006';
SELECT private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
UPDATE public.order_items SET product_offer_id=offer_id_snapshot, offer_id=offer_id_snapshot WHERE id='00000000-0000-0000-0000-000000000006';
-- Replay keeps the same matching unit and never claims a second one.
SELECT private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') <> 1 THEN RAISE EXCEPTION 'replay duplicated reservation'; END IF;
END $$;
UPDATE public.variant_inventory SET status='available', order_id=NULL, order_item_id=NULL, reserved_at=NULL, reservation_expires_at=NULL WHERE order_item_id='00000000-0000-0000-0000-000000000006';
UPDATE public.order_items SET product_offer_id='00000000-0000-0000-0000-000000000009', offer_id='00000000-0000-0000-0000-000000000009', offer_id_snapshot='00000000-0000-0000-0000-000000000009' WHERE id='00000000-0000-0000-0000-000000000006';
DO $$ BEGIN
 BEGIN
  PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
  RAISE EXCEPTION 'strict shortage accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN RAISE EXCEPTION 'shortage left reservation'; END IF;
END $$;
UPDATE public.products SET inventory_tracking_policy='serialized_then_unlimited' WHERE id='00000000-0000-0000-0000-000000000001';
DO $$ DECLARE result jsonb; BEGIN
 result := private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
 IF (result->>'missingUnitCount')::integer <> 1 THEN RAISE EXCEPTION 'unlimited fallback missing count incorrect'; END IF;
 IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN RAISE EXCEPTION 'unlimited fallback claimed wrong condition'; END IF;
END $$;
UPDATE public.products SET inventory_tracking_policy='serialized_strict' WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE public.order_items SET product_offer_id=NULL, offer_id=NULL, offer_id_snapshot=NULL, offer_line=true WHERE id='00000000-0000-0000-0000-000000000006';
DO $$ BEGIN
 BEGIN
  PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
  RAISE EXCEPTION 'deleted offer treated as ordinary product';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
UPDATE public.order_items SET offer_line=false WHERE id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,status,created_at) VALUES ('00000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','available','2026-01-03');
DO $$ BEGIN
 PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
 IF (SELECT id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000019'::uuid THEN RAISE EXCEPTION 'ordinary claim took offer-assigned unit'; END IF;
END $$;
-- A single active branch is advertised by public availability even when the
-- order has no explicit branch. The offer claim must use the same pool.
UPDATE public.variant_inventory SET status='available', order_id=NULL, order_item_id=NULL, reserved_at=NULL, reservation_expires_at=NULL WHERE order_item_id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',true);
UPDATE public.variant_inventory SET branch_id='00000000-0000-0000-0000-000000000021' WHERE id='00000000-0000-0000-0000-000000000008';
UPDATE public.order_items SET product_offer_id='00000000-0000-0000-0000-000000000003',offer_id='00000000-0000-0000-0000-000000000003',offer_line=true WHERE id='00000000-0000-0000-0000-000000000006';
DO $$ BEGIN
 PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
 IF (SELECT id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000008'::uuid THEN RAISE EXCEPTION 'single branch offer unit not reserved'; END IF;
END $$;
UPDATE public.variant_inventory SET status='available', order_id=NULL, order_item_id=NULL, reserved_at=NULL, reservation_expires_at=NULL WHERE order_item_id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010',true);
DO $$ BEGIN
 BEGIN
  PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
  RAISE EXCEPTION 'ambiguous branch unit was reserved';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
-- Taking a global unit must not silently move it to the sole active branch.
DELETE FROM public.branches WHERE id='00000000-0000-0000-0000-000000000022';
UPDATE public.variant_inventory SET branch_id=NULL WHERE id='00000000-0000-0000-0000-000000000008';
DO $$ BEGIN
 PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
 IF (SELECT branch_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000008') IS NOT NULL THEN RAISE EXCEPTION 'global unit moved to branch'; END IF;
END $$;
