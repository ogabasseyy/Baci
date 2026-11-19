-- read_goal_wallet_setup_health reads the wall clock (clock_timestamp()) for
-- its as-of time, which changes even within a statement, so it is VOLATILE,
-- not STABLE. Relabel only: the body, grants and security are unchanged.
-- Append-only: a new migration rather than an edit of 20261112100000.
ALTER FUNCTION piggyvest_primary.read_goal_wallet_setup_health(uuid, text, jsonb)
  VOLATILE;
