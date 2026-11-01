DO $$ DECLARE reservation uuid; BEGIN
 reservation := private.reserve_quiz_product_prize_v2('00000000-0000-0000-0000-000000000021');
 IF (SELECT inventory_unit_id FROM public.quiz_prize_reservations WHERE id=reservation) IS DISTINCT FROM '00000000-0000-0000-0000-000000000004'::uuid THEN
  RAISE EXCEPTION 'quiz prize selected a condition-assigned unit';
 END IF;
 BEGIN
  PERFORM private.reserve_quiz_product_prize_v2('00000000-0000-0000-0000-000000000022');
  RAISE EXCEPTION 'quiz prize consumed assigned-only stock';
 EXCEPTION WHEN SQLSTATE 'QZ044' THEN NULL; END;
 IF (SELECT status FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000003') <> 'available' THEN
  RAISE EXCEPTION 'assigned offer unit changed';
 END IF;
END $$;
UPDATE public.products SET inventory_tracking_policy='serialized_then_unlimited';
INSERT INTO public.quiz_events VALUES ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000010',2,'live','{"prize_product_id":"00000000-0000-0000-0000-000000000001"}');
DO $$ DECLARE reservation uuid; BEGIN
 reservation := private.reserve_quiz_product_prize_v2('00000000-0000-0000-0000-000000000023');
 IF NOT EXISTS (SELECT 1 FROM public.quiz_prize_reservations WHERE id=reservation AND inventory_kind='unlimited' AND inventory_unit_id IS NULL) THEN
  RAISE EXCEPTION 'unlimited quiz prize must not consume assigned units';
 END IF;
END $$;
