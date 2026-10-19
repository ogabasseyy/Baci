-- Issuance-time fulfillment identity for reward_redemptions (issue
-- #3165): the consume receipt must say which reward/product a manual
-- code was minted for even after the merchant edits or deletes the
-- reward row (reward_id is ON DELETE SET NULL), so the name and
-- product are snapshotted onto the redemption at mint.
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS reward_name text,
  ADD COLUMN IF NOT EXISTS reward_product_id uuid;

-- Freeze the fulfillment identity for codes already outstanding:
-- consume falls back to the live reward while the snapshots are NULL,
-- so a later reward edit would change what staff fulfill and a
-- deletion would leave the consumed receipt nameless. Backfill from
-- the reward as it stands now, mirroring the minimum snapshot
-- backfill (migration 20261010000011).
UPDATE public.reward_redemptions AS rr
SET reward_name = rw.name,
    reward_product_id = rw.reward_product_id
FROM public.loyalty_rewards AS rw
WHERE rw.id = rr.reward_id
  AND rr.reward_name IS NULL;
