CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.serialized_offer_order_items (
 order_item_id uuid PRIMARY KEY, merchant_id uuid NOT NULL, offer_id uuid NOT NULL
);
ALTER TABLE public.order_items ADD COLUMN offer_id uuid, ADD COLUMN offer_id_snapshot uuid;
ALTER TABLE public.variant_inventory ADD COLUMN condition_offer_id uuid, ADD COLUMN merchant_id uuid, ADD COLUMN order_id uuid;
UPDATE public.order_items SET product_offer_id='00000000-0000-0000-0000-000000000011' WHERE id='00000000-0000-0000-0000-000000000009';
