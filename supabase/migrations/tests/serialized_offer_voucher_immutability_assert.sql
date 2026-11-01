-- The real order-item guard forbids silently rewriting an existing award line.
DO $$
DECLARE blocked boolean := false;
BEGIN
 BEGIN
  UPDATE public.order_items SET offer_id='00000000-0000-0000-0000-000000000011',
   product_offer_id='00000000-0000-0000-0000-000000000011', offer_line=true
  WHERE id='00000000-0000-0000-0000-000000000006';
 EXCEPTION WHEN raise_exception THEN blocked := true;
 END;
 IF NOT blocked OR (SELECT offer_id FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006') IS NOT NULL THEN
  RAISE EXCEPTION 'existing quiz award item offer identity must be immutable';
 END IF;
END $$;
