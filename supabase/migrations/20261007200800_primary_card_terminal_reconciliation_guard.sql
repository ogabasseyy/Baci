BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.flag_reconciliation(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  UPDATE piggyvest_primary_card.operations SET state='reconciliation_required',claim_token=NULL,updated_at=clock_timestamp()
    WHERE id=operation_id AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('reserved','initializing','init_unknown','ready');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.flag_reconciliation(jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_transfer_worker,primary_card_custody_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.flag_reconciliation(jsonb,uuid) TO primary_card_evidence;
COMMIT;
