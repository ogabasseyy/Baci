-- Synthetic state for two competing submissions in the disposable cluster.
CREATE TABLE public.redvault_concurrency_request(session_id uuid, args jsonb);
DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '33333333-3333-4333-8333-333333333333';
  c uuid := 'aaaaaaaa-4900-4000-8000-000000000001';
  g uuid := 'bbbbbbbb-4900-4000-8000-000000000001';
  sid uuid;
  lid uuid;
  items jsonb;
  order_payload jsonb;
  quote jsonb := '{"discountKobo":50}'::jsonb;
BEGIN
  INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(c,m,now()+interval '1 day');
  INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at)
    VALUES(g,m,c,'race-principal',now()+interval '1 day');
  INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,condition,quantity,last_unit_price_minor)
    VALUES(m,c,p,'used',1,1000) RETURNING id INTO lid;
  INSERT INTO public.commerce_cart_checkout_sessions(
    merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,
    preparing_grant_id,reviewed_snapshot,expires_at
  ) VALUES(m,c,1,1,'race-principal',g,public.commerce_cart_build_checkout_snapshot(m,c),now()+interval '30 minutes') RETURNING id INTO sid;
  items := jsonb_build_array(jsonb_build_object('cart_line_id',lid,'product_id',p,'condition','used',
    'variant_attributes','{}'::jsonb,'quantity',1,'price',10));
  order_payload := jsonb_build_object('merchant_id',m,'customer_email','buyer@example.invalid',
    'payment_method','uba_redvault','items',items,'checkout_idempotency_key','redvault-concurrency');
  INSERT INTO public.redvault_concurrency_request VALUES(sid,jsonb_build_object(
    'p_merchant_id',m,'p_cart_id',c,'p_cart_version',1,'p_cart_principal_id','race-principal',
    'p_customer_email','buyer@example.invalid','p_payment_method','uba_redvault',
    'p_checkout_idempotency_key','redvault-concurrency','p_items',items,
    'p_redvault_order',order_payload,'p_redvault_quote',quote,
    'p_redvault_route_proof',jsonb_build_object('valid',true,'payload',jsonb_build_object('order',order_payload,'quote',quote))
  ));
END;
$$;
