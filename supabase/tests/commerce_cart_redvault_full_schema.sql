\set ON_ERROR_STOP on
-- This suite runs only on a disposable, fully replayed Supabase database.
-- The actual REDVAULT proof, draft and cart functions run in one transaction;
-- no provider request occurs and every fixture is rolled back.
BEGIN;
SET LOCAL statement_timeout = '120s';
\ir ../migrations/tests/redvault-public-product-full-schema-seed.sql
\ir ../migrations/tests/redvault-private-pilot-full-schema-setup.sql

UPDATE public.products SET taxable=true,vat_rate=7.5,vat_category_code='S',
  inventory_tracking_policy='off',has_variants=false
WHERE id=(SELECT product_id FROM redvault_private_pilot_case);
UPDATE redvault_private_pilot_case SET
  quote=jsonb_set(jsonb_set(quote,'{lines,0,vatRateBp}','750'),'{groups,0,vatRateBp}','750');
SELECT private.configure_uba_redvault_public_product_test(true,(SELECT product_id FROM redvault_private_pilot_case));

CREATE TEMP TABLE redvault_cart_case (
  cart_id uuid, grant_id uuid, session_id uuid, line_id uuid,
  submitted jsonb, order_payload jsonb, quote jsonb, first_result jsonb, replay_result jsonb
) ON COMMIT DROP;
INSERT INTO redvault_cart_case(cart_id,grant_id,session_id,line_id,quote)
SELECT extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),quote FROM redvault_private_pilot_case;
INSERT INTO public.commerce_carts(id,merchant_id,expires_at)
SELECT cart_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',now()+interval '1 day' FROM redvault_cart_case;
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at)
SELECT grant_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',cart_id,'redvault-fixture',now()+interval '1 day' FROM redvault_cart_case;
INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,condition,quantity,last_unit_price_minor)
SELECT c.line_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',c.cart_id,p.product_id,'new',1,10000
FROM redvault_cart_case c CROSS JOIN redvault_private_pilot_case p;
INSERT INTO public.commerce_cart_checkout_sessions(
  id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,
  preparing_grant_id,reviewed_snapshot,expires_at
)
SELECT session_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',cart_id,1,1,'redvault-fixture',grant_id,
  public.commerce_cart_build_checkout_snapshot('6b5cb8a4-5575-456c-b936-8cdfae30db74',cart_id),
  now()+interval '30 minutes' FROM redvault_cart_case;

UPDATE redvault_cart_case c SET submitted=jsonb_build_array(jsonb_build_object(
  'cart_line_id',c.line_id,'product_id',p.product_id,'condition','new','variant_attributes','{}'::jsonb,
  'price',100,'quantity',1,'__baci_line_ordinal',1
)) FROM redvault_private_pilot_case p;
UPDATE redvault_cart_case c SET order_payload=p.order_input || jsonb_build_object(
  'user_id',NULL,'customer_email','redvault-cart@example.invalid','payment_method','uba_redvault',
  'checkout_idempotency_key','redvault-cart-full-schema', 'expected_total',NULL,
  'tax_amount',7.5,'items',c.submitted,
  'shipping_address',jsonb_build_object('address','Pickup at Store','city','Lagos','state','Lagos')
) FROM redvault_private_pilot_case p;
GRANT SELECT,UPDATE ON redvault_cart_case TO authenticated;

SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','storefront_redvault_customer_email','redvault-cart@example.invalid',
  'storefront_order_context','route','storefront_order_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text,true);

-- Exercise the ordinary checkout path as well as REDVAULT. The storefront
-- writer previously preserved supplied line ordinals and used a generated
-- fallback for older callers; neither path should inherit another's line ID.
DO $$
DECLARE
  product uuid;
  ordinal_order uuid;
  legacy_order uuid;
  ordinal_item jsonb;
BEGIN
  SELECT ordinary_product_id INTO STRICT product FROM redvault_private_pilot_case;
  ordinal_item := jsonb_build_object(
    'product_id',product,'condition','new','quantity',1,'__baci_line_ordinal',721
  );
  SELECT id INTO STRICT ordinal_order FROM private.create_storefront_order(
    p_merchant_id => '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    p_customer_email => 'ordinal-fixture@example.invalid',
    p_customer_name => 'Ordinal fixture',
    p_items => jsonb_build_array(ordinal_item)
  );
  IF (SELECT line_id FROM public.order_items WHERE order_id=ordinal_order) IS DISTINCT FROM 721 THEN
    RAISE EXCEPTION 'storefront_line_ordinal_not_preserved';
  END IF;
  SELECT id INTO STRICT legacy_order FROM private.create_storefront_order(
    p_merchant_id => '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    p_customer_email => 'legacy-fixture@example.invalid',
    p_customer_name => 'Legacy fixture',
    p_items => jsonb_build_array(ordinal_item - '__baci_line_ordinal')
  );
  IF (SELECT line_id FROM public.order_items WHERE order_id=legacy_order) IS NULL THEN
    RAISE EXCEPTION 'storefront_legacy_line_fallback_missing';
  END IF;
  BEGIN
    PERFORM * FROM private.create_storefront_order(
      p_merchant_id => '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      p_customer_email => 'duplicate-fixture@example.invalid',
      p_customer_name => 'Duplicate fixture',
      p_items => jsonb_build_array(ordinal_item,ordinal_item)
    );
    RAISE EXCEPTION 'duplicate_line_ordinal_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'duplicate_line_ordinal' THEN RAISE; END IF;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  c redvault_cart_case%ROWTYPE;
  args jsonb;
  result jsonb;
  replay jsonb;
  attempt record;
BEGIN
  SELECT * INTO STRICT c FROM redvault_cart_case;
  args := jsonb_build_object(
    'p_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74',
    'p_cart_id',c.cart_id,'p_cart_version',1,'p_cart_principal_id','redvault-fixture',
    'p_customer_email','redvault-cart@example.invalid','p_payment_method','uba_redvault',
    'p_checkout_idempotency_key','redvault-cart-full-schema','p_items',c.submitted,
    'p_redvault_order',c.order_payload,'p_redvault_quote',c.quote,
    'p_redvault_route_proof',public.redvault_private_pilot_test_route_proof(c.order_payload,c.quote)
  );
  result := public.create_storefront_order_with_cart_binding('redvault',c.session_id,1,args);
  replay := public.create_storefront_order_with_cart_binding('redvault',c.session_id,1,args);
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'replayed' IS DISTINCT FROM 'false'
    OR replay->>'replayed' IS DISTINCT FROM 'true'
    OR result->'order'->>'id' IS DISTINCT FROM replay->'order'->>'id' THEN
    RAISE EXCEPTION 'redvault_cart_full_schema_receipt_mismatch';
  END IF;
  SELECT * INTO STRICT attempt FROM public.reserve_storefront_redvault_payment_attempt_v3((result->'order'->>'id')::uuid);
  IF attempt.amount_kobo IS DISTINCT FROM 10250::bigint OR attempt.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'redvault_cart_full_schema_amount_mismatch';
  END IF;
  UPDATE redvault_cart_case SET first_result=result,replay_result=replay;
END;
$$;
RESET ROLE;

DO $$
DECLARE c redvault_cart_case%ROWTYPE; v_order_id uuid;
BEGIN
  SELECT * INTO STRICT c FROM redvault_cart_case;
  v_order_id := (c.first_result->'order'->>'id')::uuid;
  IF (SELECT state FROM public.commerce_carts WHERE id=c.cart_id) IS DISTINCT FROM 'completed'
    OR (SELECT status FROM public.commerce_cart_checkout_sessions WHERE id=c.session_id) IS DISTINCT FROM 'submitted'
    OR (SELECT count(*) FROM public.orders WHERE id=v_order_id) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id=v_order_id AND line_id=1)
    OR (SELECT count(*) FROM private.uba_redvault_applications WHERE private.uba_redvault_applications.order_id=v_order_id) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=v_order_id AND o.payment_status='unpaid'
      AND o.shipping_provider IS NULL AND o.shipping_address->>'address'='Pickup at Store') THEN
    RAISE EXCEPTION 'redvault_cart_full_schema_binding_mismatch';
  END IF;
END;
$$;

-- Recovery of a submitted order stays bound to the original user, grant and
-- idempotency key, while an unsubmitted session can be retired atomically.
CREATE TEMP TABLE redvault_reconciliation_case(cart_id uuid, grant_id uuid, session_id uuid) ON COMMIT DROP;
INSERT INTO redvault_reconciliation_case VALUES (extensions.gen_random_uuid(), extensions.gen_random_uuid(), extensions.gen_random_uuid());
INSERT INTO public.commerce_carts(id,merchant_id,expires_at)
SELECT cart_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',now()+interval '1 day' FROM redvault_reconciliation_case;
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at)
SELECT grant_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',cart_id,'reconcile-fixture',now()-interval '1 minute' FROM redvault_reconciliation_case;
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,preparing_grant_id,expires_at)
SELECT session_id,'6b5cb8a4-5575-456c-b936-8cdfae30db74',cart_id,1,1,'reconcile-fixture',grant_id,now()-interval '1 minute' FROM redvault_reconciliation_case;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','commerce_cart_shopper','cart_scope','checkout_recovery','exp',floor(extract(epoch FROM now()+interval '1 minute')),
  'cart_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74','cart_id',cart_id,'cart_grant_id',grant_id,
  'cart_principal_id','reconcile-fixture','cart_recovery_session_id',session_id,'cart_recovery_generation',1,
  'cart_recovery_version',1,'cart_recovery_email','redvault-cart@example.invalid','cart_recovery_user_id','guest',
  'cart_recovery_key_hash',encode(extensions.digest('redvault-cart-full-schema','sha256'),'hex')
)::text,true) FROM redvault_reconciliation_case;
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE result jsonb;
BEGIN
  result := public.commerce_cart_reconcile_redvault_checkout();
  IF result->>'kind' IS DISTINCT FROM 'retired' THEN RAISE EXCEPTION 'reconciliation_did_not_retire'; END IF;
  IF public.commerce_cart_reconcile_redvault_checkout()->>'kind' IS DISTINCT FROM 'retired' THEN RAISE EXCEPTION 'retirement_not_idempotent'; END IF;
  PERFORM set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb || jsonb_build_object('cart_scope','session'))::text,true);
  IF public.commerce_cart_reconcile_redvault_checkout()->>'kind' IS DISTINCT FROM 'unavailable' THEN RAISE EXCEPTION 'ordinary_cart_scope_accepted'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT status FROM public.commerce_cart_checkout_sessions WHERE id=(SELECT session_id FROM redvault_reconciliation_case)) IS DISTINCT FROM 'retired' THEN RAISE EXCEPTION 'retirement_not_persisted'; END IF;
  IF has_function_privilege('anon','public.commerce_cart_reconcile_redvault_checkout()','EXECUTE') OR has_function_privilege('authenticated','public.commerce_cart_reconcile_redvault_checkout()','EXECUTE') THEN RAISE EXCEPTION 'reconciliation_overgranted'; END IF;
END $$;
-- Even if an earlier-started order reaches the database after reconciliation,
-- the real bound-order RPC must refuse the retired checkout session.
UPDATE public.commerce_cart_grants SET expires_at=now()+interval '1 day'
WHERE id=(SELECT grant_id FROM redvault_reconciliation_case);
GRANT SELECT ON redvault_reconciliation_case TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','storefront_redvault_customer_email','redvault-cart@example.invalid',
  'storefront_order_context','route','storefront_order_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text,true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE c redvault_cart_case%ROWTYPE; r redvault_reconciliation_case%ROWTYPE; args jsonb;
BEGIN
  SELECT * INTO STRICT c FROM redvault_cart_case;
  SELECT * INTO STRICT r FROM redvault_reconciliation_case;
  args := jsonb_build_object(
    'p_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74',
    'p_cart_id',r.cart_id,'p_cart_version',1,'p_cart_principal_id','reconcile-fixture',
    'p_customer_email','redvault-cart@example.invalid','p_payment_method','uba_redvault',
    'p_checkout_idempotency_key','redvault-cart-full-schema','p_items',c.submitted,
    'p_redvault_order',c.order_payload,'p_redvault_quote',c.quote,
    'p_redvault_route_proof',public.redvault_private_pilot_test_route_proof(c.order_payload,c.quote)
  );
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('redvault',r.session_id,1,args);
    RAISE EXCEPTION 'retired_checkout_submitted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','commerce_cart_shopper','cart_scope','checkout_recovery','exp',floor(extract(epoch FROM now()+interval '1 minute')),
  'cart_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74','cart_id',cart_id,'cart_grant_id',grant_id,
  'cart_principal_id','redvault-fixture','cart_recovery_session_id',session_id,'cart_recovery_generation',1,
  'cart_recovery_version',1,'cart_recovery_email','redvault-cart@example.invalid','cart_recovery_user_id','guest',
  'cart_recovery_key_hash',encode(extensions.digest('redvault-cart-full-schema','sha256'),'hex')
)::text,true) FROM redvault_cart_case;
SELECT set_config('test.redvault_expected_order',(first_result->'order'->>'id'),true) FROM redvault_cart_case;
SET LOCAL ROLE commerce_cart_shopper;
DO $$
DECLARE claims jsonb := current_setting('request.jwt.claims')::jsonb; result jsonb;
BEGIN
  result := public.commerce_cart_reconcile_redvault_checkout();
  IF result->>'kind' IS DISTINCT FROM 'submitted' OR result->>'orderId' IS DISTINCT FROM current_setting('test.redvault_expected_order') THEN RAISE EXCEPTION 'submitted_reconciliation_mismatch'; END IF;
  PERFORM set_config('request.jwt.claims',(claims || jsonb_build_object('cart_recovery_key_hash',repeat('0',64)))::text,true);
  IF public.commerce_cart_reconcile_redvault_checkout()->>'kind' IS DISTINCT FROM 'unavailable' THEN RAISE EXCEPTION 'wrong_recovery_key_accepted'; END IF;
  PERFORM set_config('request.jwt.claims',(claims || jsonb_build_object('cart_recovery_user_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))::text,true);
  IF public.commerce_cart_reconcile_redvault_checkout()->>'kind' IS DISTINCT FROM 'unavailable' THEN RAISE EXCEPTION 'wrong_recovery_user_accepted'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'Full-schema REDVAULT shared-cart and free store-pickup regression passed; no provider request.'
