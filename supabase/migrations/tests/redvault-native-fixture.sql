CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.discount_codes(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,code text,discount_type text,discount_value numeric,applies_to text,is_active boolean,minimum_purchase_amount numeric,maximum_discount_amount numeric,product_ids jsonb,category_ids jsonb,usage_limit integer,usage_limit_per_customer integer,starts_at timestamptz,expires_at timestamptz,usage_count integer DEFAULT 0);
CREATE TABLE public.merchants(id uuid PRIMARY KEY,country text);
INSERT INTO public.merchants(id,country) VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74','NG');
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid,brand text,name text,price numeric,condition text,vat_category_code text,vat_rate numeric,has_variants boolean DEFAULT false,variant_model text,inventory_tracking_policy text DEFAULT 'off',inventory_anchor_variant_id uuid);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid,price_override numeric,merchant_id uuid,inventory_tracking_policy text);
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,customer_email text,payment_method text,payment_status text,subtotal numeric DEFAULT 0,shipping_fee numeric DEFAULT 0,discount_amount numeric DEFAULT 0,tax_amount numeric DEFAULT 0,gift_wrapping_fee numeric DEFAULT 0,total numeric,currency text DEFAULT 'NGN',tracking_token text,shipping_status text DEFAULT 'pending',cancelled_at timestamptz,amount_paid numeric DEFAULT 0,paid_at timestamptz,updated_at timestamptz,order_number text,branch_id uuid,fulfillment_details jsonb,wallet_amount_used numeric DEFAULT 0,recorded_by_user_id uuid,shipped_at timestamptz,delivered_at timestamptz,tracking_number text,shipping_provider text,shipment_id uuid);
CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),line_id integer,product_id uuid REFERENCES public.products(id),variant_id uuid,condition text,variant_attributes jsonb,price numeric,quantity integer,vat_category_code text,vat_rate numeric,fulfillment_data jsonb);
CREATE TABLE public.variant_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,variant_id uuid,branch_id uuid,identifier_type text,identifier_value text,status text,source text,order_id uuid,order_item_id uuid,sold_at timestamptz,reservation_expires_at timestamptz,updated_at timestamptz,reserved_at timestamptz,first_reserved_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE public.transactions(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,order_id uuid,transaction_type text NOT NULL,amount numeric NOT NULL,currency text NOT NULL,status text,gateway text,gateway_reference text,gateway_response jsonb,updated_at timestamptz,metadata jsonb DEFAULT '{}'::jsonb,platform_fee numeric DEFAULT 0);
CREATE TABLE public.shipments(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,order_id uuid NOT NULL,provider text NOT NULL,status text,tracking_number text,tracking_history jsonb,updated_at timestamptz);
CREATE TABLE public.payment_side_effects(order_id uuid,transaction_id uuid,step text,status text,claimed_by text,error text,result jsonb,PRIMARY KEY(order_id,step));
CREATE TABLE public.customer_savings_redemptions(order_id uuid,merchant_id uuid,amount numeric,metadata jsonb);
CREATE TABLE public.reconciliation_review(issue_type text,txn_id uuid,paystack_ref text,order_id uuid,reason text,candidates jsonb,metadata jsonb);
CREATE TABLE public.discount_code_usage(discount_code_id uuid REFERENCES public.discount_codes(id), customer_email text);
CREATE TABLE private.quiz_rpc_server_secrets(secret_name text,secret text,expires_at timestamptz);
CREATE FUNCTION public.quiz_log_route_proof_failure(jsonb,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.quiz_compare_signatures(text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = $2 $$;
CREATE FUNCTION private.ensure_product_inventory_anchor_variant(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION private.sync_serialized_stock(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION private.record_variant_inventory_event(uuid, uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION private.sanitize_error_context(value jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT COALESCE(value, '{}'::jsonb) $$;
CREATE FUNCTION private.release_order_inventory_units(uuid, uuid, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('releasedCount', 0) $$;
CREATE FUNCTION public.create_storefront_order(
  p_merchant_id uuid,p_customer_email text,p_customer_name text,p_items jsonb,p_customer_phone text,
  p_shipping_fee numeric,p_discount_amount numeric,p_tax_amount numeric,p_payment_method text,p_payment_status text,
  p_shipping_status text,p_shipping_address jsonb,p_source text,p_notes text,p_ad_tracking jsonb,p_selected_quote_id uuid,
  p_shipping_provider text,p_tracking_number text,p_user_id uuid,p_tax_basis text,p_gift_wrapping_fee numeric,
  p_expected_total numeric,p_checkout_idempotency_key text,p_checkout_request_hash text
) RETURNS TABLE(id uuid) LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.orders(merchant_id,customer_email,payment_method,payment_status,discount_amount)
    VALUES(p_merchant_id,p_customer_email,p_payment_method,p_payment_status,p_discount_amount) RETURNING orders.id INTO v_id;
  INSERT INTO public.order_items(order_id,line_id,product_id,variant_id,condition,variant_attributes,price,quantity,vat_category_code,vat_rate)
    SELECT v_id,ordinality::integer,p.id,NULLIF(item->>'variant_id','')::uuid,COALESCE(NULLIF(trim(item->>'condition'),''),p.condition),COALESCE(item->'variant_attributes','{}'::jsonb),COALESCE(v.price_override,p.price),(item->>'quantity')::integer,COALESCE(p.vat_category_code,'S'),COALESCE(p.vat_rate,7.5)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS input(item,ordinality)
    JOIN public.products p ON p.id = (item->>'product_id')::uuid AND p.merchant_id = p_merchant_id
    LEFT JOIN public.product_variants v ON v.id = NULLIF(item->>'variant_id','')::uuid AND v.product_id = p.id;
  RETURN QUERY SELECT v_id;
END;
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
