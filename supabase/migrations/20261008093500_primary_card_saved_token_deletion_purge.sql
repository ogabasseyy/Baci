BEGIN;
-- Purge reusable card tokens on account deletion. A checkout completed
-- with saveCard:true stores the Paystack authorization code, provider
-- customer code, and email in collections.saved_token: a reusable
-- charging credential. Account deletion detaches (but retains) the
-- operation and its collection, so without a purge the credential
-- survives permanent deletion. A BEFORE DELETE trigger NULLs the
-- token for the deleted customer's operations while the customer link
-- is still intact; provider_transaction_id, evidence, and every other
-- non-secret field stay for the recovery trail. Blocked deletions
-- (unsettled card/savings guards) roll the purge back with the rest
-- of the statement, so a retained account keeps its token.
CREATE OR REPLACE FUNCTION piggyvest_primary_card.purge_saved_tokens_on_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE piggyvest_primary_card.collections collection
  SET saved_token = NULL
  FROM piggyvest_primary_card.operations operation
  WHERE collection.operation_id = operation.id
    AND operation.customer_id = OLD.id
    AND collection.saved_token IS NOT NULL;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS primary_card_purge_saved_tokens_on_customer_deletion ON public.customers;
CREATE TRIGGER primary_card_purge_saved_tokens_on_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.purge_saved_tokens_on_customer_deletion();
COMMIT;
