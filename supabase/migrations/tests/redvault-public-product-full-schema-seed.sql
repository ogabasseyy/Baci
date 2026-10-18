DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.merchants) OR EXISTS (SELECT 1 FROM public.orders)
    OR EXISTS (SELECT 1 FROM private.uba_redvault_refunds) THEN
    RAISE EXCEPTION 'public_product_fixture_requires_empty_disposable_database';
  END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('70261bce-d358-45a4-9ede-8b9d71fb3bd9') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role='replica';
INSERT INTO public.merchants(id,email,slug,business_name,paystack_subaccount_code,vat_registration_status,vat_rate)
VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74','redvault-fixture@example.invalid',
  'redvault-fixture','REDVAULT isolated fixture','ACCT_redvault_fixture','registered',7.5) ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role='origin';
WITH code AS (
  INSERT INTO public.discount_codes(merchant_id,code,discount_type,discount_value,
    minimum_purchase_amount,maximum_discount_amount,usage_limit,usage_limit_per_customer,
    is_active,applies_to,product_ids,category_ids)
  VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74','REDVAULT-FIXTURE','percentage',5,
    0,5,NULL,NULL,true,'all','[]'::jsonb,'[]'::jsonb)
  RETURNING id,merchant_id
)
INSERT INTO private.uba_redvault_discount_binding(discount_code_id,merchant_id,partnership)
SELECT id,merchant_id,'uba_redvault' FROM code;
UPDATE private.uba_redvault_runtime SET enabled=true,commercial_terms_confirmed=true,
  paystack_bank_code='033',paystack_verified_issuer_name='UBA TEST BANK',paystack_verification_domain='test',
  commercial_terms=jsonb_build_object(
    'campaign_dates',jsonb_build_object('starts_at','2000-01-01T00:00:00Z','ends_at','2100-01-01T00:00:00Z'),
    'minimum_spend',jsonb_build_object('eligible_subtotal_kobo',10000),
    'caps',jsonb_build_object('discount_kobo',500),
    'usage_limits',jsonb_build_object('usage_limit',NULL,'usage_limit_per_customer',NULL),
    'stacking',jsonb_build_object('fixture',true),
    'split_payments',jsonb_build_object('fixture',true),
    'funding_fees',jsonb_build_object('fixture',true),
    'refund_usage_restoration',jsonb_build_object('fixture',true),
    'operations_owner',jsonb_build_object('fixture',true))
WHERE partnership='uba_redvault';
