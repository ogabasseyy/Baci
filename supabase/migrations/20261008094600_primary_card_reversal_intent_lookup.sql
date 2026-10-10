-- Look up a checkout intent by its provider-facing reference for
-- money-out reconciliation. Paystack's documented refund webhook
-- carries no metadata — only the original transaction reference — so
-- the reversal path cannot build a scope from webhook fields. The
-- reference embeds the operation UUID; this lookup resolves it to the
-- stored intent, and the caller asserts the stored tenant IDs against
-- the runtime (stronger than metadata binding: every compared value
-- comes from our own table or deployment, never the delivery).
BEGIN;
CREATE FUNCTION piggyvest_primary_card.read_reversal_intent(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  IF p_reference IS NULL OR p_reference !~ '^pvb-first-primary-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid reversal reference' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations
    WHERE id=split_part(p_reference,'pvb-first-primary-',2)::uuid;
  RETURN piggyvest_primary_card.project(operation);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.read_reversal_intent(text)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.read_reversal_intent(text) TO primary_card_evidence;
COMMIT;
