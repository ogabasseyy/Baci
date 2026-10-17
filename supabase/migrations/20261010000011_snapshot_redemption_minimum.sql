-- Snapshot the checkout minimum at redemption issuance (issue #3165).
--
-- The checkout wrapper enforced the LIVE loyalty_rewards minimum, so a
-- merchant raising it after issuance stranded an already-paid code the
-- catalog had disclosed under the old terms. The 05 mint now stores the
-- terms on the redemption row and 09 enforces the snapshot (falling back
-- to the live value for rows minted before this column existed).
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS minimum_order_amount numeric(10,2);

-- Freeze the currently enforced term for codes already outstanding:
-- both checkout lookup paths fall back to the live reward minimum
-- while the snapshot is NULL, so a later reward edit (or deletion)
-- would rewrite an issued code's terms. Backfill from the reward as
-- it stands now (0 where the reward carries no minimum, matching the
-- mint's explicit-0 stamp). Rows whose reward is already gone keep
-- the NULL fallback; nothing else can reconstruct their terms.
UPDATE public.reward_redemptions AS rr
SET minimum_order_amount = COALESCE(rw.minimum_order_amount, 0)
FROM public.loyalty_rewards AS rw
WHERE rw.id = rr.reward_id
  AND rr.minimum_order_amount IS NULL;
