-- A recorded wallet is not proof that it is the only provider account.
-- Duplicate-creation review keeps one wallet's IDs but the earlier customer's
-- DVA also needs reconciliation. Closing the recorded wallet cannot discharge
-- that ownership hold. Legacy review rows have no reason and are held too.
BEGIN;

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
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.customer_id = OLD.id
      AND (intent.state IN ('dispatched', 'unknown')
        OR (intent.state = 'rejected'
          AND (intent.provider_wallet_id IS NULL
            OR intent.review_reason IS DISTINCT FROM 'routing')))
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unresolved provider onboarding' USING ERRCODE = 'P0001';
  END IF;
  -- Only a specifically classified routing rejection can use the ordinary
  -- mapped-DVA closure rule. Its ownership was proven before routing_pending.
  -- Other rejected rows require reconciliation of every matching provider
  -- customer; this migration grants no automatic hold release or adoption.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.customer_id = OLD.id
      AND intent.provider_wallet_id IS NOT NULL
      AND intent.provider_closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with open provider DVA' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

COMMIT;
