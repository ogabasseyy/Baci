BEGIN;
SELECT set_config('request.jwt.claims', '{"storefront_order_context":"route"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_storefront_redvault_checkout_summary('00000000-0000-4000-8000-000000000000'::uuid);
    RAISE EXCEPTION 'missing order unexpectedly returned a checkout summary';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'redvault_customer_context_required' THEN
      RAISE;
    END IF;
  END;
END;
$$;
ROLLBACK;
SELECT 'Checkout summary rejects missing orders without ambiguous column errors' AS result;
