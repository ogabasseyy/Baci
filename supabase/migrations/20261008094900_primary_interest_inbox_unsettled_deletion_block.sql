BEGIN;
-- Reject customer deletion while a paid-interest payout is still queued
-- or being processed. apply_paid_interest resolves its crosswalk
-- through eligible_interest_crosswalk, which joins live customers and
-- goals, so detaching the goal would return the receipt to prerequisite
-- forever even though the provider paid the money. Attribution joins
-- the signed payload's customer and wallet selection to an enabled
-- crosswalk on one of the deleted customer's goals: only mappings that
-- can still resolve block, so disabled crosswalks and terminal inbox
-- rows (processed or quarantined) keep deleting normally. A BEFORE
-- DELETE trigger (rather than editing the shared deleter) covers every
-- delete path. No account is permanently locked: pending rows drain
-- through claim/process/retry while the customer exists.
CREATE OR REPLACE FUNCTION piggyvest_primary.block_unsettled_interest_inbox_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.paid_interest_inbox inbox
    WHERE inbox.state IN ('pending','processing')
      AND EXISTS (
        SELECT 1 FROM piggyvest_primary.paid_interest_crosswalks mapping
        JOIN public.customer_savings_goals goal ON goal.id = mapping.goal_id
        WHERE goal.customer_id = OLD.id
          AND mapping.integration_id = inbox.integration_id
          AND mapping.enabled
          AND mapping.webhook_customer_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'customer_id')
          AND mapping.source_wallet_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'pvb_wallet')
          AND mapping.accrued_wallet_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'pvb_accrued_interest_wallet')
          AND mapping.destination_wallet_id = (convert_from(inbox.payload,'UTF8')::jsonb->'eventData'->>'destination_wallet')
          AND mapping.envelope_destination_wallet_id IS NOT DISTINCT FROM (convert_from(inbox.payload,'UTF8')::jsonb->>'pvb_destination_wallet')
      )
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled interest payouts' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS primary_interest_block_unsettled_inbox_customer_deletion ON public.customers;
CREATE TRIGGER primary_interest_block_unsettled_inbox_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_interest_inbox_customer_deletion();
-- bank_role_safe fails any session that can execute a piggyvest_primary
-- function outside its allowlist, so the default PUBLIC grant must go
-- (revoked trigger functions still fire). Mirrors the 093800 hygiene
-- form: bank roles are deliberately not named so this migration stays
-- includable in chains without the bank surface.
REVOKE ALL ON FUNCTION piggyvest_primary.block_unsettled_interest_inbox_customer_deletion()
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
