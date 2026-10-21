-- Disposable database regression; run after the storefront fixture and migrations.
-- The PDP core snapshot must emit the anchor-derived effective policy on
-- product_data so snapshot consumers (v2 PDP offer pricing) can cap offer
-- math by the strict serialized pool for simple products whose hidden
-- anchor supplies serialized tracking while the row policy is `off`.
RESET ROLE;
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('33000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pdp-policy-owner@example.com', 'test',
  now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('00000000-0000-4000-8000-000000000009', '33000000-0000-4000-8000-000000000002',
  'pdp-policy@example.com', 'PDP Policy', 'pdp-policy-fixture', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;
ALTER TABLE public.products DISABLE TRIGGER USER;
INSERT INTO public.products(id, merchant_id, name, slug, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers, inventory_tracking_policy)
VALUES ('33000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','pdp anchor strict','pdp-anchor-strict-phone','active',100,5,5,true,false,true,'off'),
('33000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000009','pdp plain','pdp-plain-phone','active',100,5,5,true,false,true,'off');
-- No multi-anchor fixture: idx_product_variants_one_inventory_anchor
-- forbids two anchors per product, so the ORDER BY id tiebreak is a
-- deterministic guard, not a live branch.
ALTER TABLE public.products ENABLE TRIGGER USER;
ALTER TABLE public.product_variants DISABLE TRIGGER USER;
INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor)
VALUES ('43000000-0000-4000-8000-000000000013','33000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','serialized_strict',true);
ALTER TABLE public.product_variants ENABLE TRIGGER USER;
ALTER TABLE public.variant_inventory DISABLE TRIGGER USER;
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,identifier_type,identifier_value,status)
VALUES ('53000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000009','imei','611111111111131','available'),
('53000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000009','imei','611111111111132','available');
ALTER TABLE public.variant_inventory ENABLE TRIGGER USER;
SET ROLE anon;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.get_storefront_pdp_core_v2('00000000-0000-4000-8000-000000000009', 'pdp-anchor-strict-phone');
  IF r.resolution_status <> 'found' THEN RAISE EXCEPTION 'anchor product snapshot not found'; END IF;
  IF r.product_data->>'effective_policy' <> 'serialized_strict' THEN RAISE EXCEPTION 'anchor-derived effective policy not emitted'; END IF;
  IF (r.product_data->>'stock_quantity')::int <> 2 THEN RAISE EXCEPTION 'anchor units not folded into snapshot stock'; END IF;

  SELECT * INTO r FROM public.get_storefront_pdp_core_v2('00000000-0000-4000-8000-000000000009', 'pdp-plain-phone');
  IF r.resolution_status <> 'found' THEN RAISE EXCEPTION 'plain product snapshot not found'; END IF;
  IF r.product_data->>'effective_policy' <> 'off' THEN RAISE EXCEPTION 'plain product must emit off policy'; END IF;
END $$;
RESET ROLE;
