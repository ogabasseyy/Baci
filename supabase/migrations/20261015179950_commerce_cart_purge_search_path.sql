-- Pin the terminal purge function to the cart chain's search_path
-- convention: every other SECURITY DEFINER function in the chain uses
-- SET search_path = '', and the purge body already fully qualifies
-- its relations, so this is a drop-in hardening with no behavior
-- change.
ALTER FUNCTION public.commerce_cart_purge_terminal_carts(interval, integer)
  SET search_path = '';
