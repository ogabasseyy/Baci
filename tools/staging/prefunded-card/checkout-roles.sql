BEGIN;

REVOKE ALL ON FUNCTION prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint),
  prefunded_card.checkout_reserve(jsonb,jsonb),
  prefunded_card.checkout_read(jsonb,jsonb),
  prefunded_card.checkout_claim_initialization(jsonb,jsonb),
  prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
  prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb),
  prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),
  prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,prefunded_treasury_operator,prefunded_authorizer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_evidence') THEN
    REVOKE ALL ON FUNCTION prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint),
      prefunded_card.checkout_reserve(jsonb,jsonb),
      prefunded_card.checkout_read(jsonb,jsonb),
      prefunded_card.checkout_claim_initialization(jsonb,jsonb),
      prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
      prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb),
      prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),
      prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)
      FROM prefunded_evidence;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint),
  prefunded_card.checkout_reserve(jsonb,jsonb),
  prefunded_card.checkout_read(jsonb,jsonb) TO prefunded_treasury_operator;
GRANT EXECUTE ON FUNCTION prefunded_card.checkout_claim_initialization(jsonb,jsonb),
  prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
  prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb),
  prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),
  prefunded_card.checkout_flag_reconciliation(jsonb,jsonb) TO prefunded_authorizer;

REVOKE ALL ON prefunded_card.checkout_intents FROM prefunded_treasury_operator,prefunded_authorizer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_evidence') THEN
    REVOKE ALL ON prefunded_card.checkout_intents FROM prefunded_evidence;
  END IF;
END $$;
COMMIT;
