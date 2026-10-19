-- Keep the replay snapshot probe off public PostgREST callers:
-- revoke EXECUTE from anon and require the server-minted
-- storefront_order_context = 'route' claim bound to p_merchant_id
-- before returning the committed order snapshot.
CREATE OR REPLACE FUNCTION public.storefront_checkout_replay_snapshot(
  p_merchant_id uuid,
  p_checkout_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_merchant_id IS NULL
    OR p_checkout_idempotency_key IS NULL
    OR pg_catalog.btrim(p_checkout_idempotency_key) !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{64})$'
    OR COALESCE(auth.jwt() ->> 'storefront_order_context', '') <> 'route'
    OR COALESCE(auth.jwt() ->> 'storefront_order_merchant_id', '') <> p_merchant_id::text THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE merchant_id = p_merchant_id
    AND checkout_idempotency_key = pg_catalog.btrim(p_checkout_idempotency_key)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order.id,
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'product_id', i.product_id,
          'variant_id', i.variant_id,
          'condition', i.condition,
          'price', i.price
        )
        ORDER BY i.line_id NULLS LAST, i.id
      )
      FROM public.order_items i
      WHERE i.order_id = v_order.id
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.storefront_checkout_replay_snapshot(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storefront_checkout_replay_snapshot(uuid, text)
  TO authenticated, service_role;
