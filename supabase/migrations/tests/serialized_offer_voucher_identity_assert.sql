-- The same award, merchant, product, and condition may select its own offer.
DO $$ BEGIN
 PERFORM private.validate_serialized_quiz_voucher_offer(
  '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000007',
  '{"offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}'::jsonb);
 BEGIN
  PERFORM private.validate_serialized_quiz_voucher_offer(
   '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000007',
   '{"offer_id":"00000000-0000-0000-0000-000000000011","condition":"new"}'::jsonb);
  RAISE EXCEPTION 'condition mismatch accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM <> 'quiz_voucher_offer_invalid' THEN RAISE; END IF;
 END;
END $$;
