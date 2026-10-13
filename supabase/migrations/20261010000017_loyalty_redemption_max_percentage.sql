-- Maximum redemption percentage snapshot (issue #3165).
--
-- loyalty_settings.maximum_redemption_percentage ("Max % of Order
-- with Points") was never read by the redemption or checkout RPCs, so
-- a merchant's configured ceiling did not bind issued codes. Stamp it
-- on the redemption row at mint; the checkout bridge caps the applied
-- discount at that share of the order subtotal.
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS max_redemption_percentage numeric;
