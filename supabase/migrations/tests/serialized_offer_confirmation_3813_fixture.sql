-- Recreate #3813's legacy helper boundary in the isolated confirmation test.
ALTER TABLE public.order_items ADD COLUMN offer_labels_snapshotted boolean DEFAULT false;
CREATE FUNCTION private.release_stale_offer_line_serialized_units(uuid, uuid, uuid, uuid, jsonb)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 UPDATE public.variant_inventory SET status='available', order_id=NULL, order_item_id=NULL
 WHERE order_item_id=$3 AND status='reserved';
END $$;
