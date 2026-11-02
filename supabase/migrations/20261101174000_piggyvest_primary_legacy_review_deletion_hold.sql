-- Older onboarding executors record explicit rejections with
-- record_onboarding_rejection, which leaves review_reason NULL. That row is
-- indistinguishable from a definitive foreign-customer rejection even though
-- a previous ambiguous provider creation may have reached an older runtime.
-- Fail closed for every rejected intent without a provider wallet until an
-- operator has reconciled ownership and provider custody. No automatic
-- release or new grant is introduced here.
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
  -- Dispatched/unknown protects the crash window before the hold can be
  -- persisted. Rejected rows without a provider wallet include both current
  -- ownership holds and older record_onboarding_rejection writes whose
  -- review_reason is NULL; neither has enough evidence to permit deletion.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.customer_id = OLD.id
      AND (intent.state IN ('dispatched', 'unknown')
        OR (intent.state = 'rejected' AND intent.provider_wallet_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unresolved provider onboarding' USING ERRCODE = 'P0001';
  END IF;
  -- Mapped wallets, including routing-rejected wallets, retain the existing
  -- provider DVA closure requirement independently of their review reason.
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
