-- Snapshot the checkout minimum at redemption issuance (issue #3165).
--
-- The checkout wrapper enforced the LIVE loyalty_rewards minimum, so a
-- merchant raising it after issuance stranded an already-paid code the
-- catalog had disclosed under the old terms. The 05 mint now stores the
-- terms on the redemption row and 09 enforces the snapshot (falling back
-- to the live value for rows minted before this column existed).
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS minimum_order_amount numeric(10,2);
