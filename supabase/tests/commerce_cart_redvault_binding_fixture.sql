-- The cart binding is real. This deterministic REDVAULT leaf stands in for
-- the separate REDVAULT full-schema suite and records only synthetic orders.
CREATE TABLE public.redvault_binding_fixture_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_key text NOT NULL UNIQUE,
  order_payload jsonb NOT NULL,
  quote_payload jsonb NOT NULL
);

CREATE FUNCTION public.create_storefront_redvault_order(
  p_order jsonb, p_quote jsonb, p_route_proof jsonb
) RETURNS TABLE (
  id uuid, quote_version_id uuid, quote_payload_hash text,
  proof_context jsonb, status text, idempotency_replayed boolean
) LANGUAGE plpgsql AS $$
DECLARE
  existing public.redvault_binding_fixture_orders%ROWTYPE;
  created uuid;
BEGIN
  IF p_route_proof->'payload' IS DISTINCT FROM jsonb_build_object('order', p_order, 'quote', p_quote)
    OR p_route_proof->>'valid' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'redvault_proof_rejected';
  END IF;
  IF p_order->>'customer_email' IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email' THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  SELECT * INTO existing FROM public.redvault_binding_fixture_orders
    WHERE checkout_key = p_order->>'checkout_idempotency_key';
  IF FOUND THEN
    IF existing.order_payload IS DISTINCT FROM p_order OR existing.quote_payload IS DISTINCT FROM p_quote THEN
      RAISE EXCEPTION 'checkout_idempotency_conflict';
    END IF;
    RETURN QUERY SELECT existing.id, '55555555-5555-4555-8555-555555555555'::uuid,
      repeat('a', 64), '{}'::jsonb, 'pending'::text, true;
    RETURN;
  END IF;
  INSERT INTO public.redvault_binding_fixture_orders(checkout_key, order_payload, quote_payload)
    VALUES (p_order->>'checkout_idempotency_key', p_order, p_quote) RETURNING redvault_binding_fixture_orders.id INTO created;
  IF p_order->>'fixture_failure' = 'after_write' THEN
    RAISE EXCEPTION 'redvault_fixture_failed';
  END IF;
  RETURN QUERY SELECT created, '55555555-5555-4555-8555-555555555555'::uuid,
    repeat('a', 64), '{}'::jsonb, 'pending'::text, false;
END;
$$;
