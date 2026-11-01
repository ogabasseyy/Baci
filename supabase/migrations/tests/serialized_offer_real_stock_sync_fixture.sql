-- Install the production status-change trigger and its stock-sync function in
-- the isolated lifecycle fixture, including the row locks they actually take.
ALTER TABLE public.products ADD COLUMN stock integer DEFAULT 0, ADD COLUMN stock_quantity integer DEFAULT 0, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.product_variants ADD COLUMN stock_quantity integer DEFAULT 0, ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TRIGGER trg_sync_variant_inventory_stock
  AFTER INSERT OR DELETE OR UPDATE OF status, variant_id ON public.variant_inventory
  FOR EACH ROW EXECUTE FUNCTION private.on_variant_inventory_change();
