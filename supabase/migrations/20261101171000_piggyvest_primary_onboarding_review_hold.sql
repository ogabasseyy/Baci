-- Preserve unresolved provider custody when creation succeeded but its IDs
-- could not be recorded. An ambiguous lookup must not become a walletless,
-- deletable rejection. Terminal review also needs a durable status read so
-- refreshing an account never disguises a rejected routing check as pending.
BEGIN;

ALTER TABLE piggyvest_primary.onboarding_intents
  ADD COLUMN IF NOT EXISTS review_reason text
    CHECK (review_reason IN ('routing', 'ownership'))
    CHECK (review_reason IS NULL OR state = 'rejected');

-- resolve_onboarding_routing clears the temporary payout ID; retain only
-- the review classification. Ordinary executors cannot clear this evidence.
CREATE OR REPLACE FUNCTION piggyvest_primary.guard_onboarding_review_reason()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.review_reason IS NOT NULL AND NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
    RAISE EXCEPTION 'onboarding review evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'routing_pending' AND NEW.state = 'rejected' THEN
    NEW.review_reason := 'routing';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS primary_onboarding_review_reason_guard ON piggyvest_primary.onboarding_intents;
CREATE TRIGGER primary_onboarding_review_reason_guard
  BEFORE UPDATE ON piggyvest_primary.onboarding_intents
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_onboarding_review_reason();

CREATE OR REPLACE FUNCTION piggyvest_primary.record_onboarding_ownership_hold(scope jsonb, intent_id uuid, token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  UPDATE piggyvest_primary.onboarding_intents SET
    state = 'rejected', review_reason = 'ownership', claim_token = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = intent_id AND integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'dispatched' AND claim_token = token;
  RETURN FOUND;
END $$;

-- Return a classification only: no wallet, customer, payout or claim IDs.
-- Older rejections without a reason still require ownership review.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_onboarding_review(scope jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result text;
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  SELECT coalesce(intent.review_reason, 'ownership') INTO result
  FROM piggyvest_primary.onboarding_intents intent
  WHERE intent.integration_id = (scope->>'integrationId')::uuid
    AND intent.merchant_id = (scope->>'merchantId')::uuid
    AND intent.customer_id = (scope->>'customerId')::uuid
    AND intent.user_id = (scope->>'userId')::uuid AND intent.state = 'rejected';
  RETURN result;
END $$;

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
  -- persisted. A held identifier stays attached for operator reconciliation;
  -- no automatic release or wallet adoption is granted by this migration.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.customer_id = OLD.id
      AND (intent.state IN ('dispatched', 'unknown')
        OR (intent.review_reason = 'ownership' AND intent.provider_wallet_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unresolved provider onboarding' USING ERRCODE = 'P0001';
  END IF;
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

REVOKE ALL ON FUNCTION piggyvest_primary.guard_onboarding_review_reason(),
  piggyvest_primary.record_onboarding_ownership_hold(jsonb,uuid,uuid),
  piggyvest_primary.read_onboarding_review(jsonb),
  piggyvest_primary.block_unsettled_bank_inbox_customer_deletion()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.record_onboarding_ownership_hold(jsonb,uuid,uuid),
  piggyvest_primary.read_onboarding_review(jsonb)
  TO piggyvest_primary_provisioner;
COMMIT;
