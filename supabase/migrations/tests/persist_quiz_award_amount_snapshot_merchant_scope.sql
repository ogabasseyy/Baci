-- Regression for cross-tenant quiz award snapshot reads.
DO $$
DECLARE
  v_foreign_merchant_id uuid := gen_random_uuid();
  v_foreign_event_id uuid := gen_random_uuid();
  v_foreign_award_id uuid := gen_random_uuid();
  v_order_item_id uuid;
  v_original_award_id uuid;
  v_award_id uuid;
  v_amount numeric;
BEGIN
  SELECT ordinary_item_id, ordinary_award_id
  INTO v_order_item_id, v_original_award_id
  FROM pg_temp.quiz_award_snapshot_fixture;

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_foreign_merchant_id,
    format('quiz-award-foreign-%s@example.com', txid_current()),
    'Quiz Award Foreign Merchant',
    format('quiz-award-foreign-%s', txid_current())
  );

  INSERT INTO public.quiz_events (id, merchant_id, slug, title, status)
  VALUES (
    v_foreign_event_id,
    v_foreign_merchant_id,
    format('quiz-award-foreign-event-%s', txid_current()),
    'Quiz Award Foreign Event',
    'active'
  );

  INSERT INTO public.quiz_awards (
    id,
    event_id,
    customer_id,
    award_type,
    status,
    amount
  )
  SELECT
    v_foreign_award_id,
    v_foreign_event_id,
    qa.customer_id,
    'grand',
    'claimed',
    999
  FROM public.quiz_awards AS qa
  WHERE qa.id = v_original_award_id;

  ALTER TABLE public.order_items
    ENABLE TRIGGER sync_order_item_quiz_award_snapshot;

  UPDATE public.order_items
  SET
    quiz_award_id = v_foreign_award_id,
    quiz_award_amount = 999
  WHERE id = v_order_item_id;

  SELECT quiz_award_id, quiz_award_amount
  INTO v_award_id, v_amount
  FROM public.order_items
  WHERE id = v_order_item_id;
  IF v_award_id IS NOT NULL OR v_amount IS NOT NULL THEN
    RAISE EXCEPTION
      'cross-tenant award marker was copied into an order item: id %, amount %',
      v_award_id,
      v_amount;
  END IF;

  UPDATE public.order_items
  SET quiz_award_id = v_original_award_id
  WHERE id = v_order_item_id;

  SELECT quiz_award_amount
  INTO v_amount
  FROM public.order_items
  WHERE id = v_order_item_id;
  IF v_amount IS DISTINCT FROM 125 THEN
    RAISE EXCEPTION
      'same-merchant award amount was not restored: %',
      v_amount;
  END IF;
END;
$$ LANGUAGE plpgsql;
