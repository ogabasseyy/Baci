-- Constrain the cart event worker to the publish path: the broad
-- direct table policies from 20261012050100 made the single
-- cross-merchant worker credential able to read and mutate every
-- merchant's event outbox if leaked. The publisher already goes
-- through commerce_cart_publish_events (SECURITY DEFINER, granted to
-- the worker in 20261014070000), and retention runs through the
-- SECURITY DEFINER cleanup as the scheduler owner, so the worker
-- needs no direct table access at all.
REVOKE SELECT, UPDATE ON public.commerce_cart_events
  FROM commerce_cart_worker;

DROP POLICY IF EXISTS commerce_cart_events_worker_select
  ON public.commerce_cart_events;
DROP POLICY IF EXISTS commerce_cart_events_worker_update
  ON public.commerce_cart_events;

-- Re-affirm the publish grant where the broadcast migration is part
-- of the applied chain (it grants the same in 20261014070000).
DO $$
BEGIN
  IF to_regprocedure('public.commerce_cart_publish_events(integer, text)')
    IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.commerce_cart_publish_events(integer, text)
      TO commerce_cart_worker;
  END IF;
END $$;
