-- Publication snapshots and workflow history are private owner data. Erasure of
-- an owner, merchant or connection must remove this dependent state, including
-- verifier proofs. Revoking a connection still uses its existing soft-revoke
-- path; this migration changes physical deletion only and grants no new access.
BEGIN;
ALTER TABLE builder_authorization.publication_intents
 DROP CONSTRAINT publication_intents_actor_user_id_fkey,
 ADD CONSTRAINT publication_intents_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_intents_connection_id_fkey,
 ADD CONSTRAINT publication_intents_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES builder_authorization.connections(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_intents_merchant_id_fkey,
 ADD CONSTRAINT publication_intents_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
ALTER TABLE builder_authorization.publication_receipts
 DROP CONSTRAINT publication_receipts_intent_id_fkey,
 ADD CONSTRAINT publication_receipts_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES builder_authorization.publication_intents(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_receipts_actor_user_id_fkey,
 ADD CONSTRAINT publication_receipts_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_receipts_connection_id_fkey,
 ADD CONSTRAINT publication_receipts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES builder_authorization.connections(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_receipts_merchant_id_fkey,
 ADD CONSTRAINT publication_receipts_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
ALTER TABLE builder_authorization.publication_outbox
 DROP CONSTRAINT publication_outbox_receipt_id_fkey,
 ADD CONSTRAINT publication_outbox_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES builder_authorization.publication_receipts(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_outbox_actor_user_id_fkey,
 ADD CONSTRAINT publication_outbox_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_outbox_merchant_id_fkey,
 ADD CONSTRAINT publication_outbox_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
ALTER TABLE builder_authorization.publication_audit
 DROP CONSTRAINT publication_audit_receipt_id_fkey,
 ADD CONSTRAINT publication_audit_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES builder_authorization.publication_receipts(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_audit_actor_user_id_fkey,
 ADD CONSTRAINT publication_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_audit_merchant_id_fkey,
 ADD CONSTRAINT publication_audit_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
ALTER TABLE builder_authorization.publication_checks
 DROP CONSTRAINT publication_checks_intent_id_fkey,
 ADD CONSTRAINT publication_checks_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES builder_authorization.publication_intents(id) ON DELETE CASCADE,
 DROP CONSTRAINT publication_checks_receipt_id_fkey,
 ADD CONSTRAINT publication_checks_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES builder_authorization.publication_receipts(id) ON DELETE CASCADE;
COMMIT;
