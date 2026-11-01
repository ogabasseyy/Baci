CREATE SCHEMA private;
CREATE TABLE public.quiz_events (id uuid PRIMARY KEY, merchant_id uuid);
CREATE TABLE public.customers (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.quiz_awards (id uuid PRIMARY KEY, event_id uuid, customer_id uuid, amount numeric, reserved_order_id uuid, reserved_order_item_id uuid, status text, claimed_at timestamptz, route_proof_id text, product_id uuid, condition text, variant_id uuid);
CREATE TABLE public.orders (id uuid PRIMARY KEY, order_number text, tracking_token text, subtotal numeric, shipping_fee numeric, discount_amount numeric, tax_amount numeric, total numeric, customer_id uuid, customer_email text, customer_name text, customer_phone text, payment_status text, shipping_status text, payment_method text, shipping_address jsonb, merchant_id uuid, tax_basis text, gift_wrapping_fee numeric, shipping_provider text, selected_quote_id uuid, tracking_number text, notes text, updated_at timestamptz, fulfillment_details jsonb);
CREATE TABLE public.order_items (id uuid PRIMARY KEY, order_id uuid, product_id uuid, variant_id uuid, condition text, product_offer_id uuid, offer_id uuid, offer_id_snapshot uuid, offer_line boolean, offer_grade text, offer_condition_notes text, offer_labels_snapshotted boolean, fulfillment_data jsonb);
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid, inventory_anchor_variant_id uuid, inventory_tracking_policy text);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, merchant_id uuid, product_id uuid, is_inventory_anchor boolean, inventory_tracking_policy text);
CREATE TABLE public.product_offers (id uuid PRIMARY KEY, merchant_id uuid, product_id uuid, condition text, status text);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, merchant_id uuid, variant_id uuid REFERENCES public.product_variants(id), condition_offer_id uuid, order_id uuid, order_item_id uuid, status text);
CREATE TABLE private.serialized_offer_order_items (order_item_id uuid PRIMARY KEY, merchant_id uuid, offer_id uuid);
CREATE FUNCTION public.quiz_route_proof_valid(jsonb,text,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
INSERT INTO public.quiz_events VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO public.customers VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');
INSERT INTO public.orders(id,merchant_id,customer_id) VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
INSERT INTO public.order_items(id,order_id,product_id,condition) VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000007','used');
INSERT INTO public.quiz_awards(id,event_id,customer_id,amount,reserved_order_id,reserved_order_item_id,status) VALUES ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',100,'00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006','approved');
UPDATE public.quiz_awards SET product_id='00000000-0000-0000-0000-000000000007', condition='used';
INSERT INTO public.products VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','serialized_strict');
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000007',true,'inherit');
INSERT INTO public.product_offers VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000007','used','active');
INSERT INTO public.variant_inventory VALUES ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012',NULL,'00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006','reserved'), ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000011',NULL,NULL,'available');

CREATE FUNCTION public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.get_effective_inventory_tracking_policy(text,text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif($2,'inherit'),$1) $$;

-- Real ranked quiz awards store the reserved unit in both snapshots.
UPDATE public.orders SET fulfillment_details=jsonb_build_object(
  'source','merchant_stock','reservationExpiresAt',NULL,
  'inventoryUnits',jsonb_build_array(jsonb_build_object('inventoryUnitId','00000000-0000-0000-0000-000000000009')),
  'missingUnitCount',0) WHERE id='00000000-0000-0000-0000-000000000005';
UPDATE public.order_items SET fulfillment_data=(SELECT fulfillment_details FROM public.orders
  WHERE id='00000000-0000-0000-0000-000000000005')
  WHERE id='00000000-0000-0000-0000-000000000006';
-- The transferred prize reservation is historical provenance, not a new hold.
CREATE TABLE public.quiz_prize_reservations (
 id uuid PRIMARY KEY, event_id uuid, merchant_id uuid, inventory_unit_id uuid,
 state text, award_id uuid
);
INSERT INTO public.quiz_prize_reservations VALUES (
 '00000000-0000-0000-0000-000000000013',
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000009',
 'transferred', '00000000-0000-0000-0000-000000000008'
);
ALTER TABLE public.product_offers ADD COLUMN stock_quantity integer NOT NULL DEFAULT 5;
ALTER TABLE public.product_offers ADD COLUMN grade text;
ALTER TABLE public.product_offers ADD COLUMN condition_notes text;
ALTER TABLE public.product_offers ADD COLUMN price numeric NOT NULL DEFAULT 50;
ALTER TABLE public.order_items ADD COLUMN quantity integer NOT NULL DEFAULT 1;
ALTER TABLE public.variant_inventory ADD COLUMN sold_at timestamptz;
ALTER TABLE public.variant_inventory ADD COLUMN reserved_at timestamptz;
ALTER TABLE public.variant_inventory ADD COLUMN reservation_expires_at timestamptz;
ALTER TABLE public.variant_inventory ADD COLUMN updated_at timestamptz;
CREATE TABLE private.variant_inventory_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inventory_unit_id uuid, merchant_id uuid,
 product_id uuid, variant_id uuid, event_type text, from_status text, to_status text,
 order_id uuid, order_item_id uuid, branch_id uuid, actor_user_id uuid, actor_role text,
 event_context jsonb
);
-- The fixture supplies only ancillary dependencies; the runner loads the
-- actual claim function and condition-pool patch from repository migrations.
ALTER TABLE public.orders ADD COLUMN branch_id uuid;
ALTER TABLE public.products ADD COLUMN stock_quantity integer DEFAULT 0;
ALTER TABLE public.products ADD COLUMN stock integer DEFAULT 0;
ALTER TABLE public.products ADD COLUMN updated_at timestamptz;
ALTER TABLE public.product_variants ADD COLUMN stock_quantity integer DEFAULT 0;
ALTER TABLE public.product_variants ADD COLUMN updated_at timestamptz;
ALTER TABLE public.products ADD COLUMN has_variants boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN variant_model text DEFAULT 'legacy';
ALTER TABLE public.variant_inventory ADD COLUMN branch_id uuid;
ALTER TABLE public.variant_inventory ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.variant_inventory ADD COLUMN first_reserved_at timestamptz;
ALTER TABLE public.variant_inventory ADD COLUMN identifier_type text;
ALTER TABLE public.variant_inventory ADD COLUMN identifier_value text;
CREATE TABLE public.branches (id uuid PRIMARY KEY, merchant_id uuid, active boolean);
CREATE FUNCTION private.ensure_product_inventory_anchor_variant(uuid,uuid) RETURNS uuid LANGUAGE sql AS $$
 SELECT inventory_anchor_variant_id FROM public.products WHERE merchant_id=$1 AND id=$2
$$;
CREATE FUNCTION private.sync_serialized_stock(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN shipped_at timestamptz;
ALTER TABLE public.orders ADD COLUMN delivered_at timestamptz;
ALTER TABLE public.orders ADD COLUMN shipment_id uuid;
ALTER TABLE public.orders ADD COLUMN shipment_booking_lock_token uuid;
UPDATE public.orders SET shipping_status='pending' WHERE shipping_status IS NULL;
CREATE TABLE public.shipments (id uuid PRIMARY KEY, order_id uuid);
