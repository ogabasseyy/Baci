-- Terminalize provider-abandoned checkouts and release the customer for a
-- fresh operation. Paystack marks a checkout 'abandoned' when the customer
-- cancels or walks away; that transaction can never complete, so keeping
-- the operation 'ready' pins the customer to a dead checkout through the
-- one-unresolved-operation index with no path to retry. The new 'abandoned'
-- state is terminal and excluded from the unresolved index predicate, so a
-- subsequent reserve with a new idempotency key succeeds. Only 'ready'
-- operations transition (idempotent for 'abandoned' so concurrent status
-- checks acknowledge); custody-bound operations are never touched.
BEGIN;
ALTER TABLE piggyvest_primary_card.operations DROP CONSTRAINT operations_state_check;
ALTER TABLE piggyvest_primary_card.operations ADD CONSTRAINT operations_state_check CHECK(state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required','completed','abandoned'));
CREATE FUNCTION piggyvest_primary_card.record_abandonment(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  UPDATE piggyvest_primary_card.operations SET state='abandoned',claim_token=NULL,updated_at=clock_timestamp()
    WHERE id=operation_id AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid AND state IN ('ready','abandoned');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.record_abandonment(jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.record_abandonment(jsonb,uuid) TO primary_card_evidence;
COMMIT;
