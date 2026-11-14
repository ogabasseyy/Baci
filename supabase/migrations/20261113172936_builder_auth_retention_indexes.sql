-- Support bounded expiry cleanup; review locking and table size before rollout.
CREATE INDEX builder_provider_records_expiry_idx
  ON builder_authorization.provider_records (expires_at, model, id);
CREATE INDEX builder_transactions_expiry_idx
  ON builder_authorization.transactions (expires_at, id_hash);
