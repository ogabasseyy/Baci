-- Install the nullable delivery columns before the application revision that
-- selects them is promoted. The deferred enforcement migration adds the
-- constraints and trigger after the new revision is serving traffic.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS airport_type text;

COMMENT ON COLUMN public.orders.delivery_method IS
  'Checkout delivery method captured at order creation (door, pickup, airport, or pickup_station).';

COMMENT ON COLUMN public.orders.airport_type IS
  'Airport fulfillment mode for airport orders (delivery or pickup).';
