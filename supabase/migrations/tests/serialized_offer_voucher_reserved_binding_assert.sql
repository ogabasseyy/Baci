-- The stored award must point to an item for the same product and order.
UPDATE public.order_items SET product_id='00000000-0000-0000-0000-000000000099' WHERE id='00000000-0000-0000-0000-000000000006';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM private.validate_serialized_quiz_voucher_offer(
   '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000007',
   '{"offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}'::jsonb);
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM <> 'quiz_voucher_offer_invalid' THEN RAISE; END IF;
  rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'award must not bind a reserved item for a different product'; END IF;
END $$;

UPDATE public.order_items SET product_id='00000000-0000-0000-0000-000000000007', order_id='00000000-0000-0000-0000-000000000099' WHERE id='00000000-0000-0000-0000-000000000006';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM private.validate_serialized_quiz_voucher_offer(
   '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000007',
   '{"offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}'::jsonb);
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM <> 'quiz_voucher_offer_invalid' THEN RAISE; END IF;
  rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'award must not bind an item from a different order'; END IF;
END $$;
