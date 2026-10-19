-- Creation receipts are written only by the SECURITY DEFINER cart
-- writers (commerce_cart_create and successors). The bootstrap-scope
-- shopper role never inserts directly, but its INSERT grant plus the
-- permissive bootstrap policy let any bootstrap principal forge a
-- receipt row: an arbitrary cart_id/grant_id/digest/result presented
-- as a legitimate idempotent creation. Revoke the direct write path
-- so receipts can only exist where a definer writer created them.
DROP POLICY IF EXISTS commerce_cart_creation_requests_shopper_bootstrap_insert
  ON public.commerce_cart_creation_requests;

REVOKE INSERT ON public.commerce_cart_creation_requests
  FROM commerce_cart_shopper;
