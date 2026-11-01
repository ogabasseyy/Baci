ALTER TABLE public.products ADD COLUMN price numeric DEFAULT 100, ADD COLUMN manage_stock boolean DEFAULT true;
ALTER TABLE public.product_variants ADD COLUMN stock_quantity integer DEFAULT 0, ADD COLUMN price_override numeric, ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN status text DEFAULT 'active', ADD COLUMN deleted_at timestamptz, ADD COLUMN archived_at timestamptz, ADD COLUMN is_default boolean DEFAULT false;
CREATE TABLE public.commerce_carts (id uuid PRIMARY KEY, merchant_id uuid, currency text);
CREATE TABLE public.commerce_cart_lines (id uuid PRIMARY KEY, merchant_id uuid, cart_id uuid, created_at timestamptz, product_id uuid, variant_id uuid, condition text, options jsonb, quantity integer, negotiated_unit_price_minor bigint, negotiation_status text, voucher_token text, voucher_award_id text, has_assurance boolean, assurance_rate numeric, last_unit_price_minor bigint);
CREATE FUNCTION public.commerce_cart_condition_supported(uuid,uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.commerce_cart_product_negotiable(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- The historical repair also touches this sibling. Its real predicate is
-- represented here so the migration can apply unchanged in this fixture.
CREATE FUNCTION public.commerce_cart_require_offer(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT true FROM public.products p JOIN public.product_variants v ON v.product_id=p.id
 WHERE true AND NOT (coalesce(p.has_variants, false) AND coalesce(v.is_default, false))
   AND NOT coalesce((to_jsonb(v)->>'is_inventory_anchor')::boolean,false) LIMIT 1
$$;
INSERT INTO public.commerce_carts VALUES ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000010','NGN');
INSERT INTO public.commerce_cart_lines VALUES ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000031',now(),'00000000-0000-0000-0000-000000000001',NULL,'used','{}',3,NULL,NULL,NULL,NULL,false,0,8000);
