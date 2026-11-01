-- Ordinary authorized item metadata writes must not require access to the
-- private transition context or gain permission to rewrite offer identity.
GRANT SELECT, UPDATE ON public.order_items TO authenticated;
SET ROLE authenticated;
UPDATE public.order_items SET fulfillment_data='{"source":"merchant_stock"}'::jsonb
WHERE id='00000000-0000-0000-0000-000000000006';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  UPDATE public.order_items SET offer_line=true, product_offer_id='00000000-0000-0000-0000-000000000011'
  WHERE id='00000000-0000-0000-0000-000000000006';
 EXCEPTION WHEN raise_exception THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'direct offer transition must remain forbidden'; END IF;
END $$;
RESET ROLE;
