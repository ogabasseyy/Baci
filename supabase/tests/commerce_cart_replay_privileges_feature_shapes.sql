-- Regressions: the replay snapshot is service-role only, and the
-- canonical feature guard tolerates non-array premium_features.
DO $regression$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    AND has_function_privilege(
    'anon',
    'public.storefront_checkout_replay_snapshot(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute the replay snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    AND has_function_privilege(
    'authenticated',
    'public.storefront_checkout_replay_snapshot(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not execute the replay snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
    AND NOT has_function_privilege(
    'service_role',
    'public.storefront_checkout_replay_snapshot(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute the replay snapshot';
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
