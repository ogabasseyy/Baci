-- Issuance-time fulfillment identity for reward_redemptions (issue
-- #3165): the consume receipt must say which reward/product a manual
-- code was minted for even after the merchant edits or deletes the
-- reward row (reward_id is ON DELETE SET NULL), so the name and
-- product are snapshotted onto the redemption at mint.
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS reward_name text,
  ADD COLUMN IF NOT EXISTS reward_product_id uuid;
