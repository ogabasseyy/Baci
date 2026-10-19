-- Behavioral regression for the shared-clear guard: a legacy bridge
-- principal must not clear a cart after a shopper grant exists, and
-- the same clear succeeds once no other live non-legacy grant remains.
INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at) VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at, allowed_operations) VALUES
  ('99999999-9999-4999-8999-999999999981', '11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'legacy:ucp:agent-a', now() + interval '7 days', NULL, ARRAY['add','remove','clear','replace','set_quantity','set_assurance']),
  ('99999999-9999-4999-8999-999999999982', '11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'guest-shopper', now() + interval '7 days', NULL, ARRAY['add','remove','clear','replace','set_quantity','set_assurance']);
INSERT INTO public.commerce_cart_lines (id, merchant_id, cart_id, product_id, variant_id, quantity, negotiated_unit_price_minor, negotiation_status, last_unit_price_minor) VALUES
  ('dddddddd-dddd-4ddd-8ddd-000000000001', '11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '33333333-3333-4333-8333-333333333333', NULL, 2, NULL, NULL, 25000);

SET request.jwt.claims = '{"role":"commerce_cart_shopper","exp":4102444800,"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","cart_grant_id":"99999999-9999-4999-8999-999999999981","cart_principal_id":"legacy:ucp:agent-a","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'op-shared-clear-blocked', 1,
    '{"type":"clear"}'::jsonb
  );
  IF (v_result ->> 'ok')::boolean OR v_result ->> 'code' <> 'version_conflict' THEN
    RAISE EXCEPTION 'legacy clear after handoff must conflict, got %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE cart_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) THEN
    RAISE EXCEPTION 'blocked clear must preserve the shopper lines';
  END IF;
END
$$;
RESET ROLE;

-- Once the shopper grant is gone, the same legacy clear succeeds.
UPDATE public.commerce_cart_grants
SET revoked_at = now()
WHERE id = '99999999-9999-4999-8999-999999999982';
SET request.jwt.claims = '{"role":"commerce_cart_shopper","exp":4102444800,"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","cart_grant_id":"99999999-9999-4999-8999-999999999981","cart_principal_id":"legacy:ucp:agent-a","cart_scope":"session"}';
SET ROLE commerce_cart_shopper;
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.commerce_cart_mutate(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'op-shared-clear-after-revoke', 1,
    '{"type":"clear"}'::jsonb
  );
  IF NOT (v_result ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'legacy clear without a shopper grant must succeed, got %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE cart_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) THEN
    RAISE EXCEPTION 'successful clear must remove the lines';
  END IF;
END
$$;
RESET ROLE;

SELECT 'shared clear guard ok' AS commerce_cart_shared_clear_guard;
