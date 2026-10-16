-- Canonical enrollment guard: non-canonical shared-cart feature values
-- are rejected loudly; canonical values and unrelated values pass.
DO $$
DECLARE
  merchant uuid := '99999999-9999-4999-8999-999999999999';
  rejected boolean;
BEGIN
  INSERT INTO public.merchants (id, slug, email, premium_features)
  VALUES (merchant, 'canonical-guard-test', 'guard@example.test', '[]'::jsonb);

  rejected := false;
  BEGIN
    UPDATE public.merchants
    SET premium_features = '[" Shared_Cart "]'::jsonb
    WHERE id = merchant;
  EXCEPTION WHEN invalid_parameter_value THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'non-canonical shared_cart value must be rejected';
  END IF;

  -- Tab/newline wrapping (JavaScript-trimmable) is rejected too.
  rejected := false;
  BEGIN
    UPDATE public.merchants
    SET premium_features = jsonb_build_array(E'\tSHARED_CART\n')
    WHERE id = merchant;
  EXCEPTION WHEN invalid_parameter_value THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'whitespace-wrapped shared_cart value must be rejected';
  END IF;

  -- Non-breaking-space / BOM wrapping (ECMAScript-trimmable but outside
  -- the PostgreSQL \s class) is rejected too.
  rejected := false;
  BEGIN
    UPDATE public.merchants
    SET premium_features = jsonb_build_array(chr(160) || 'shared_cart' || chr(65279))
    WHERE id = merchant;
  EXCEPTION WHEN invalid_parameter_value THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unicode-whitespace-wrapped shared_cart value must be rejected';
  END IF;

  UPDATE public.merchants
  SET premium_features = '["shared_cart", "shared_cart_native", "Other_Feature"]'::jsonb
  WHERE id = merchant;

  DELETE FROM public.merchants WHERE id = merchant;
END $$;
