BEGIN;
-- When Paystack collection has moved a card operation to custody_pending
-- but the treasury transfer has not settled, deleting the customer
-- detaches the operation (092700) while the transfer selector and
-- custody context still require the matching customers row and verified
-- onboarding mapping: the retained outbox can no longer dispatch or
-- settle, stranding the card charge without a wallet to credit. Reject
-- customer deletion while any card operation for that customer is
-- unresolved (the one_unresolved state set). Completed and abandoned
-- operations keep detaching normally, and abandonment
-- (primary_card_abandoned_release) plus settlement keep every operation
-- moving toward a terminal state, so no account is permanently locked.
-- A BEFORE DELETE trigger (rather than editing the shared
-- delete_current_storefront_account) covers every delete path; the
-- customer-indexed EXISTS check keeps unaffected deletions cheap.
CREATE OR REPLACE FUNCTION piggyvest_primary_card.block_unsettled_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary_card.operations
    WHERE customer_id = OLD.id
      AND state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required')
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled card operations' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS primary_card_block_unsettled_customer_deletion ON public.customers;
CREATE TRIGGER primary_card_block_unsettled_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.block_unsettled_customer_deletion();
COMMIT;
