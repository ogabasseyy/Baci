-- Restore storefront EXECUTE on the phone-gated receiver projection. Public
-- repair quote/payment actions must not construct an admin client; the RPC
-- remains SECURITY DEFINER and still withholds unpublished or phoneless centers.
REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_repair_pickup_receiver(uuid) IS
  'Published repair-center destination for GIGL customer pickups; requires contact phone and stays hidden for unpublished or pickup-disabled merchants.';

NOTIFY pgrst, 'reload schema';
