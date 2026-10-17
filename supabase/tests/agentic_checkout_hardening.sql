-- Behavioral regressions for the round-68 SQL hardening:
-- zero-price negotiations parse, and the replay snapshot only
-- answers for UUID-shaped checkout credentials.
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v
  FROM public.commerce_cart_parse_input_line(
    '{"item":{"productId":"11111111-1111-4111-8111-111111111111"},"quantity":1,"negotiatedUnitPriceMinor":0}'::jsonb
  );
  IF v.pi_product IS NULL OR v.pi_negotiated <> 0 THEN
    RAISE EXCEPTION 'zero negotiated price must parse: %', v;
  END IF;

  IF strpos(
    pg_get_functiondef(
      'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure
    ),
    'count(DISTINCT l.voucher_award_id)>1'
  ) = 0 THEN
    RAISE EXCEPTION 'handoff coverage must recognize union award lanes';
  END IF;

  IF public.storefront_checkout_replay_snapshot(
    '77777777-7777-4777-8777-777777777777', 'order-123'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'predictable replay keys must resolve no snapshot';
  END IF;
  IF public.storefront_checkout_replay_snapshot(
    '77777777-7777-4777-8777-777777777777',
    '123e4567-e89b-42d3-a456-426614174000'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'unknown UUID replay keys must resolve no snapshot';
  END IF;
END
$$;
