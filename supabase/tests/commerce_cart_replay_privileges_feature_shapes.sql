-- Regressions: the replay snapshot projection is minimized (no
-- committed tax/discount amounts), and the canonical feature guard
-- tolerates non-array premium_features.
DO $regression$
BEGIN
  IF pg_get_functiondef(
    'public.storefront_checkout_replay_snapshot(uuid, text)'::regprocedure
  ) LIKE '%tax_amount%' THEN
    RAISE EXCEPTION 'replay snapshot must not project tax_amount';
  END IF;
  IF pg_get_functiondef(
    'public.storefront_checkout_replay_snapshot(uuid, text)'::regprocedure
  ) LIKE '%discount_amount%' THEN
    RAISE EXCEPTION 'replay snapshot must not project discount_amount';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.storefront_checkout_replay_snapshot(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute storefront_checkout_replay_snapshot';
  END IF;
END $regression$;

DO $regression$
DECLARE
  merchant uuid := '99999999-9999-4999-8999-999999999998';
BEGIN
  INSERT INTO public.merchants (id, slug, premium_features)
  VALUES (merchant, 'feature-shape-test', '{}'::jsonb);
  UPDATE public.merchants
  SET premium_features = '"shared_cart"'::jsonb
  WHERE id = merchant;
  UPDATE public.merchants
  SET premium_features = '42'::jsonb
  WHERE id = merchant;
  DELETE FROM public.merchants WHERE id = merchant;
END $regression$;

SELECT 'replay privileges and feature shapes ok' AS commerce_cart_access_shapes;
