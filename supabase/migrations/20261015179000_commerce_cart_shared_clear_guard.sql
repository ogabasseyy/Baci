-- Keep a legacy platform principal from emptying a cart after a
-- shopper has taken it over: when commerce_cart_mutate processes a
-- 'clear' command from a legacy bridge principal while another live
-- non-legacy grant exists for the same cart, refuse with the
-- version_conflict shape instead of deleting the shopper's lines.
-- The function body is patched textually so every earlier amendment
-- is preserved verbatim; the patch fails loudly if it cannot apply.
DO $repair$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p
  WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND p.proname = 'commerce_cart_mutate_authorized_impl'
  LIMIT 1;
  IF definition IS NULL OR position('cart_shared_clear_guard' IN definition) <> 0 THEN
    RETURN;
  END IF;
  definition := replace(definition,
    'ELSIF v_type = ''clear'' THEN
    DELETE FROM public.commerce_cart_lines',
    'ELSIF v_type = ''clear'' THEN
    -- cart_shared_clear_guard
    IF v_principal LIKE ''legacy:%'' AND EXISTS (
      SELECT 1 FROM public.commerce_cart_grants g
      WHERE g.cart_id = p_cart_id AND g.merchant_id = v_merchant
        AND g.principal_id <> v_principal
        AND g.principal_id NOT LIKE ''legacy:%''
        AND g.revoked_at IS NULL AND g.expires_at > now()
    ) THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
      RETURN jsonb_build_object(''ok'', false, ''code'', ''version_conflict'', ''replayed'', false,
        ''state'', v_state, ''currentVersion'', v_cart.version);
    END IF;
    DELETE FROM public.commerce_cart_lines');
  IF position('cart_shared_clear_guard' IN definition) = 0 THEN
    RAISE EXCEPTION 'shared clear guard patch did not apply to commerce_cart_mutate_authorized_impl';
  END IF;
  EXECUTE definition;
END $repair$;
