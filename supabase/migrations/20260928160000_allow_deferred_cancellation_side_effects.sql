-- Allow the deferred side-effect status: provider-awaiting refund work
-- parks under it without consuming the five-attempt retry budget, and the
-- drain reselects deferred rows until reconciliation advances. Without
-- this, finish_order_cancellation_side_effect fails with a check
-- violation on every deferral, the row sticks at claimed, and the
-- stale-claim sweep converts it to terminal delivery_uncertain — the
-- remaining legs never resume. Append-only: the original table check
-- (20260721093206) shipped long ago and cannot be edited. Deferred rows
-- stay inside the existing open-row index (it excludes only completed
-- and delivery_uncertain), so no index change is needed.
ALTER TABLE public.order_cancellation_side_effects
  DROP CONSTRAINT IF EXISTS order_cancellation_side_effects_status_check;
ALTER TABLE public.order_cancellation_side_effects
  ADD CONSTRAINT order_cancellation_side_effects_status_check
  CHECK (status IN (
    'claimed', 'completed', 'failed', 'delivery_uncertain', 'deferred'
  ));
