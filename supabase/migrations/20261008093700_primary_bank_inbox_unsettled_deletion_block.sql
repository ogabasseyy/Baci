BEGIN;
-- Reject customer deletion while a bank deposit is still being
-- processed. process_bank_inbox requires the deposit's intent to join
-- a live matching customer, so detaching the intent would return the
-- receipt to prerequisite forever even though the provider holds the
-- money; later deliveries for the same wallet would likewise strand
-- as ambiguous. Attribution joins the signed payload's wallet and
-- customer to the deleted customer's intents: only mappings that can
-- still resolve (accepted/verified carry provider ids; rejected and
-- pre-mapping states hold NULL and never match) block, so terminal
-- intents cannot lock the account. Terminal inbox rows (processed or
-- blocked) keep deleting normally. A BEFORE DELETE trigger (rather
-- than editing the shared deleter) covers every delete path. No
-- account is permanently locked: pending rows drain through
-- claim/process/retry (including the post-deadline drain) while the
-- customer exists.
CREATE OR REPLACE FUNCTION piggyvest_primary.block_unsettled_bank_inbox_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.bank_signed_inbox inbox
    WHERE inbox.state IN ('pending','processing')
      AND EXISTS (
        SELECT 1 FROM piggyvest_primary.onboarding_intents intent
        WHERE intent.customer_id = OLD.id
          AND intent.provider_wallet_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'pvb_wallet')
          AND intent.provider_customer_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'customer_id')
      )
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled bank deposits' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS primary_bank_block_unsettled_inbox_customer_deletion ON public.customers;
CREATE TRIGGER primary_bank_block_unsettled_inbox_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_bank_inbox_customer_deletion();
-- bank_role_safe fails any session that can execute a piggyvest_primary
-- function outside its allowlist, so the default PUBLIC grant must go
-- (revoked trigger functions still fire; the intake proves it daily).
REVOKE ALL ON FUNCTION piggyvest_primary.block_unsettled_bank_inbox_customer_deletion()
  FROM PUBLIC,anon,authenticated,service_role,primary_bank_signed_intake,primary_bank_inbox_worker;
COMMIT;
