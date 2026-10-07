-- disable-transaction
-- Follow-up to 20260926110300_piggyvest_transfer_outbox_submission: the
-- outbox claims table carries an authorization_id foreign key with no
-- supporting index, so parent authorization updates/deletes must scan the
-- entire claims table as submission history grows.
-- Production deploys split this marked migration into top-level statements
-- so PostgreSQL can build the index without blocking submission writes.
-- Retry cleanup must also be top-level: DROP INDEX CONCURRENTLY cannot run
-- inside a DO/transaction block, and normal DROP INDEX takes an ACCESS
-- EXCLUSIVE table lock. The drop also clears a leftover INVALID index from
-- an interrupted concurrent build so the CREATE below rebuilds instead of
-- skipping on the name. Rebuild-on-rerun is intentional: the DROP cannot be
-- conditioned on validity in top-level SQL, and the plain CREATE (no IF NOT
-- EXISTS) fails loudly rather than silently skipping if two deploys race.
DROP INDEX CONCURRENTLY IF EXISTS public.piggyvest_transfer_outbox_claims_authorization_idx;

CREATE INDEX CONCURRENTLY piggyvest_transfer_outbox_claims_authorization_idx
  ON public.piggyvest_transfer_outbox_submission_claims USING btree (authorization_id);

COMMENT ON INDEX public.piggyvest_transfer_outbox_claims_authorization_idx IS
  'Supports authorization parent-row updates/deletes without scanning piggyvest_transfer_outbox_submission_claims history.';
