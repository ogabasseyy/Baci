-- Follow-up to 20260926110300_piggyvest_transfer_outbox_submission: the
-- outbox claims table carries an authorization_id foreign key with no
-- supporting index, so parent authorization updates/deletes must scan the
-- entire claims table as submission history grows. Migrations are
-- append-only, so the index lands here rather than editing the original
-- migration.
CREATE INDEX IF NOT EXISTS piggyvest_transfer_outbox_claims_authorization_idx
  ON public.piggyvest_transfer_outbox_submission_claims (authorization_id);
