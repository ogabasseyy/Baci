UPDATE public.orders SET payment_status='paid' WHERE id='00000000-0000-0000-0000-000000000005';
DO $$ BEGIN
 PERFORM private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (SELECT fulfillment_data->>'refundReference' FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM 'keep-me' THEN RAISE EXCEPTION 'confirmation erased refund metadata'; END IF;
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'::uuid THEN RAISE EXCEPTION 'late confirmation reclaimed wrong condition'; END IF;
END $$;
-- A mismatched held unit is not confirmed or exposed as the ordered unit;
-- confirmation reports an exception without aborting the payment caller.
UPDATE public.variant_inventory SET reservation_expires_at=now()+interval '1 hour' WHERE id='00000000-0000-0000-0000-000000000008';
UPDATE public.order_items SET product_offer_id='00000000-0000-0000-0000-000000000009',offer_id='00000000-0000-0000-0000-000000000009',offer_id_snapshot='00000000-0000-0000-0000-000000000009' WHERE id='00000000-0000-0000-0000-000000000006';
DO $$ DECLARE result jsonb; BEGIN
 result := private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (SELECT fulfillment_data->>'refundReference' FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM 'keep-me' THEN RAISE EXCEPTION 'mismatch erased refund metadata'; END IF;
 IF NOT (result->'exceptionCodes' @> '[{"code":"serialized_offer_identity_mismatch"}]'::jsonb) THEN RAISE EXCEPTION 'mismatch exception missing'; END IF;
 IF (SELECT reservation_expires_at FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000008') IS NULL THEN RAISE EXCEPTION 'wrong unit confirmed'; END IF;
 IF (SELECT fulfillment_data->'serializedInventoryException'->>'code' FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM 'serialized_offer_identity_mismatch' THEN RAISE EXCEPTION 'item mismatch marker missing'; END IF;
END $$;
-- A deleted offer may confirm a surviving reservation, but must not reclaim a
-- new unit after that reservation has gone away.
UPDATE public.order_items SET product_offer_id=NULL,offer_id=NULL,offer_id_snapshot='00000000-0000-0000-0000-000000000003',offer_line=true WHERE id='00000000-0000-0000-0000-000000000006';
DO $$ DECLARE result jsonb; BEGIN
 result := private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (SELECT fulfillment_data ? 'serializedInventoryException' FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006') THEN RAISE EXCEPTION 'resolved exception remained in snapshot'; END IF;
 IF (result->>'missingUnitCount')::integer <> 0 OR (SELECT reservation_expires_at FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000008') IS NOT NULL THEN RAISE EXCEPTION 'surviving deleted-offer reservation was not confirmed'; END IF;
END $$;
UPDATE public.variant_inventory SET status='available',order_id=NULL,order_item_id=NULL WHERE id='00000000-0000-0000-0000-000000000008';
DO $$ DECLARE result jsonb; BEGIN
 result := private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (result->>'missingUnitCount')::integer <> 1 OR NOT (result->'exceptionCodes' @> '[{"code":"late_payment_reservation_lost"}]'::jsonb) THEN RAISE EXCEPTION 'deleted offer must report a lost reservation'; END IF;
 IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN RAISE EXCEPTION 'deleted offer reclaimed a unit'; END IF;
END $$;
-- Late reclaim follows the same branch visibility as offer availability.
UPDATE public.order_items SET product_offer_id='00000000-0000-0000-0000-000000000003',offer_id='00000000-0000-0000-0000-000000000003' WHERE id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',true);
UPDATE public.variant_inventory SET branch_id='00000000-0000-0000-0000-000000000021' WHERE id='00000000-0000-0000-0000-000000000008';
DO $$ DECLARE result jsonb; BEGIN
 result := private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (result->>'missingUnitCount')::integer <> 0 OR (SELECT id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000008'::uuid THEN RAISE EXCEPTION 'single branch reclaim failed'; END IF;
END $$;
UPDATE public.variant_inventory SET status='available',order_id=NULL,order_item_id=NULL WHERE id='00000000-0000-0000-0000-000000000008';
INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010',true);
DO $$ DECLARE result jsonb; BEGIN
 result := private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (result->>'missingUnitCount')::integer <> 1 OR EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN RAISE EXCEPTION 'ambiguous branch was reclaimed'; END IF;
END $$;
-- Ordinary orders may only reclaim units not assigned to an offer.
DELETE FROM private.serialized_offer_order_items WHERE order_item_id='00000000-0000-0000-0000-000000000006';
UPDATE public.order_items SET product_offer_id=NULL,offer_id=NULL,offer_id_snapshot=NULL,offer_line=false WHERE id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,status,created_at) VALUES ('00000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','available','2026-01-03');
DO $$ BEGIN
 PERFORM private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF (SELECT id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000019'::uuid THEN RAISE EXCEPTION 'ordinary confirmation used an assigned unit'; END IF;
END $$;
-- Pre-protocol offer orders retain #3813's stale-unit release behavior.
UPDATE public.order_items SET product_offer_id='00000000-0000-0000-0000-000000000003',offer_id='00000000-0000-0000-0000-000000000003',offer_line=true WHERE id='00000000-0000-0000-0000-000000000006';
DO $$ BEGIN
 PERFORM private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005');
 IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN
  RAISE EXCEPTION 'legacy offer reservation was not released';
 END IF;
END $$;
