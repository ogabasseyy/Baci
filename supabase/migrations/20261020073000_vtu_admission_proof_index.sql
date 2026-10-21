-- Index the merchant-wide admission proof (PR #3730 review
-- round 5: Codex P2).
--
-- vtu_admission_proof runs before every wallet-only checkout and
-- filters idempotency mappings by (merchant_id,
-- request_fingerprint) with no customer predicate. The available
-- indexes are merchant-only or customer-leading, so merchants
-- with a large history would scan and filter all their mappings
-- on every checkout to construct the live-ID snapshot —
-- avoidable latency on the payment path. Non-unique: repeat
-- purchases share the scope — never add uniqueness.
CREATE INDEX IF NOT EXISTS vtu_idempotency_keys_merchant_fingerprint_idx
  ON public.vtu_idempotency_keys(merchant_id, request_fingerprint);
