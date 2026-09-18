BEGIN;

-- The public catalog feeds read offers through the anon client, but
-- product_offers previously exposed rows only to staff. Mirror the products
-- active-status visibility so active offers of active products are readable
-- anonymously; everything else stays staff-only.
DROP POLICY IF EXISTS "Public can view active offers of active products"
  ON public.product_offers;

CREATE POLICY "Public can view active offers of active products"
ON public.product_offers FOR SELECT
USING (
  status = 'active'
  AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_offers.product_id
      AND p.status = 'active'
  )
);

COMMIT;
