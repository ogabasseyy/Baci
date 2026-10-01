ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS shipping_quote_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.shipments'::regclass
      AND conname = 'shipments_shipping_quote_id_fkey'
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_shipping_quote_id_fkey
      FOREIGN KEY (shipping_quote_id)
      REFERENCES public.shipping_quotes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_shipping_quote_id
  ON public.shipments (shipping_quote_id)
  WHERE shipping_quote_id IS NOT NULL;

COMMENT ON COLUMN public.shipments.shipping_quote_id IS
  'Effective shipping quote used to create this provider shipment.';
