-- One private capture request key per merchant, including concurrent retries.
-- A collision stops migration rather than silently discarding existing evidence.
CREATE UNIQUE INDEX experience_snapshot_preview_retry_unique
  ON public.experience_snapshots (merchant_id, left(snapshot_key->>'state', 44))
  WHERE snapshot_key->>'state' LIKE 'preview:%';
