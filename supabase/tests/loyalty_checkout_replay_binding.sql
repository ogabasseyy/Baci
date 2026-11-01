-- Exercise the installed wrapper body against isolated fixture tables/base RPC.
-- Renaming only its table/base references leaves the production call graph intact.
BEGIN;
CREATE TEMP TABLE loyalty_fixture_orders (
 id uuid,order_number text,tracking_token text,subtotal numeric,shipping_fee numeric,
 discount_amount numeric,tax_amount numeric,total numeric,customer_id uuid,customer_email text,
 customer_name text,customer_phone text,payment_status text,shipping_status text,payment_method text,
 shipping_address jsonb,merchant_id uuid,tax_basis text,gift_wrapping_fee numeric,
 idempotency_replayed boolean,checkout_idempotency_key text,currency text
);
CREATE TEMP TABLE loyalty_fixture_rewards(id uuid,minimum_order_amount numeric);
CREATE TEMP TABLE loyalty_fixture_redemptions (
 id uuid,reward_id uuid,reward_type text,reward_value numeric,discount_code text,
 expires_at timestamptz,used boolean,used_on_order_id uuid,issuance_currency text,
 max_redemption_percentage numeric,minimum_order_amount numeric,merchant_id uuid,used_at timestamptz
);
CREATE OR REPLACE FUNCTION pg_temp.loyalty_base_order(
  p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb,
  p_customer_phone text DEFAULT NULL, p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card', p_payment_status text DEFAULT 'unpaid',
  p_shipping_status text DEFAULT 'pending', p_shipping_address jsonb DEFAULT NULL,
  p_source text DEFAULT 'online_store', p_notes text DEFAULT NULL, p_ad_tracking jsonb DEFAULT NULL,
  p_selected_quote_id uuid DEFAULT NULL, p_shipping_provider text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_tax_basis text DEFAULT 'exclusive',
  p_gift_wrapping_fee numeric DEFAULT 0, p_expected_total numeric DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL, p_checkout_request_hash text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, order_number text, tracking_token text, subtotal numeric, shipping_fee numeric,
  discount_amount numeric, tax_amount numeric, total numeric, customer_id uuid, customer_email text,
  customer_name text, customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid, tax_basis text,
  gift_wrapping_fee numeric, idempotency_replayed boolean
)
LANGUAGE sql AS $fixture$
 SELECT o.id, o.order_number, o.tracking_token, o.subtotal, o.shipping_fee, o.discount_amount, o.tax_amount, o.total, o.customer_id, o.customer_email, o.customer_name, o.customer_phone, o.payment_status, o.shipping_status, o.payment_method, o.shipping_address, o.merchant_id, o.tax_basis, o.gift_wrapping_fee, o.idempotency_replayed
 FROM pg_temp.loyalty_fixture_orders o WHERE o.merchant_id=p_merchant_id
$fixture$;
DO $install$
DECLARE definition text;
BEGIN
 SELECT pg_catalog.pg_get_functiondef(
 'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure)
 INTO definition;
 definition:=replace(definition,'public.create_storefront_order_with_loyalty_code(', 'pg_temp.loyalty_order_under_test(');
 definition:=replace(definition,'public.reward_redemptions','pg_temp.loyalty_fixture_redemptions');
 definition:=replace(definition,'public.loyalty_rewards','pg_temp.loyalty_fixture_rewards');
 definition:=replace(definition,'public.orders','pg_temp.loyalty_fixture_orders');
 definition:=replace(definition,'public.create_storefront_order(', 'pg_temp.loyalty_base_order(');
 EXECUTE definition;
END;
$install$;
INSERT INTO pg_temp.loyalty_fixture_orders VALUES(
 '36890000-0000-4000-8000-000000000001','fixture','token',100,0,10,0,90,NULL,
 'loyalty@example.test','Fixture',NULL,'unpaid','pending','card',NULL,
 '36890000-0000-4000-8000-000000000002','exclusive',0,false,'fixture-key','NGN');
INSERT INTO pg_temp.loyalty_fixture_redemptions(id,reward_type,reward_value,discount_code,used,minimum_order_amount,merchant_id)
SELECT id,'discount_fixed',10,code,false,0,'36890000-0000-4000-8000-000000000002'
FROM (VALUES ('36890000-0000-4000-8000-000000000003'::uuid,'RDM-A'),
 ('36890000-0000-4000-8000-000000000004'::uuid,'RDM-B')) x(id,code);
CREATE FUNCTION pg_temp.call_loyalty_fixture(redemption uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT idempotency_replayed FROM pg_temp.loyalty_order_under_test(
 p_merchant_id=>'36890000-0000-4000-8000-000000000002',p_customer_email=>'loyalty@example.test',
 p_customer_name=>'Fixture',p_items=>'[]',p_checkout_idempotency_key=>'fixture-key',
 p_loyalty_redemption_id=>redemption)
$$;
DO $cases$
DECLARE a uuid:='36890000-0000-4000-8000-000000000003';
 b uuid:='36890000-0000-4000-8000-000000000004'; result boolean;
BEGIN
 result:=pg_temp.call_loyalty_fixture(a);
 IF result IS DISTINCT FROM false OR NOT EXISTS(SELECT 1 FROM pg_temp.loyalty_fixture_redemptions
 WHERE id=a AND used AND used_on_order_id='36890000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'fresh order did not claim code A'; END IF;
 UPDATE pg_temp.loyalty_fixture_orders SET idempotency_replayed=true;
 -- Legitimate retries retain issued-code semantics even after expiry.
 UPDATE pg_temp.loyalty_fixture_redemptions SET expires_at=now()-interval '1 day' WHERE id=a;
 IF pg_temp.call_loyalty_fixture(a) IS DISTINCT FROM true THEN RAISE EXCEPTION 'same-code retry failed'; END IF;
 BEGIN
  PERFORM pg_temp.call_loyalty_fixture(b);
  RAISE EXCEPTION 'replay consumed a different unused redemption';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'checkout_idempotency_conflict' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM pg_temp.loyalty_fixture_redemptions WHERE id=b AND (used OR used_on_order_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'code B was consumed by rejected replay'; END IF;
 -- A released claim cannot silently re-earn the same existing order's discount.
 UPDATE pg_temp.loyalty_fixture_redemptions SET used=false,used_on_order_id=NULL,expires_at=NULL WHERE id=a;
 BEGIN
  PERFORM pg_temp.call_loyalty_fixture(a);
  RAISE EXCEPTION 'replay reclaimed a released redemption';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'checkout_idempotency_conflict' THEN RAISE; END IF;
 END;
END;
$cases$;
ROLLBACK;
