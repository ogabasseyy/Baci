-- Partial index for the 5-minute stalled goal-wallet setup scan
-- (piggyvest_primary.read_goal_wallet_setup_health). The scan reads only an
-- integration's not-yet-enrolled setups older than a cutoff; the primary key
-- (integration_id, goal_id) cannot narrow that, so as enrolled setups pile up
-- the read would slow towards the evidence executor's 4-second timeout and
-- page `health_read_failed`. Enrolled rows (the vast majority) stay out of it.
-- Append-only: a new migration, the read function is unchanged.
CREATE INDEX IF NOT EXISTS piggyvest_primary_goal_wallet_intents_unenrolled_idx
  ON piggyvest_primary.goal_wallet_intents (integration_id, created_at)
  WHERE state <> 'enrolled';
