-- Maximum redemption percentage snapshot (issue #3165).
--
-- loyalty_settings.maximum_redemption_percentage ("Max % of Order
-- with Points") was never read by the redemption or checkout RPCs, so
-- a merchant's configured ceiling did not bind issued codes. Stamp it
-- on the redemption row at mint; the checkout bridge caps the applied
-- discount at that share of the order subtotal.
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS max_redemption_percentage numeric;

-- Pin codes already outstanding to the merchant's current cap: the
-- checkout bridge treats a NULL cap as uncapped, so an unstamped code
-- minted under a configured maximum would apply its full face value.
-- Mirrors redeem's mint-time read of loyalty_settings (one row per
-- merchant) and the sibling snapshot backfills (migrations 11/16/19).
UPDATE public.reward_redemptions AS rr
SET max_redemption_percentage = ls.maximum_redemption_percentage
FROM public.loyalty_settings AS ls
WHERE ls.merchant_id = rr.merchant_id
  AND rr.max_redemption_percentage IS NULL;
