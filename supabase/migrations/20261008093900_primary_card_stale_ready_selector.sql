-- Bounded server-side selection of stale ready checkouts for abandonment.
-- A 'ready' operation terminalizes today only through a later client
-- status call or a provider webhook: a customer who closes the hosted
-- checkout without paying and never returns leaves the unresolved slot
-- and its treasury reservation held indefinitely (the transfer worker
-- selects only custody_pending rows). This selector returns at most
-- `maximum` ready operations older than `stale_before` so a worker can
-- re-verify each against the provider and abandon only what Paystack
-- confirms dead. Authority mirrors the drain assert_scope: integration
-- pins plus exact expiresAt/callbackUrl equality and the evidence login,
-- without the freshness check, so post-expiry rows drain too. Selection
-- alone changes nothing; abandonment still goes through
-- record_abandonment per operation with its full ownership scope.
BEGIN;
CREATE FUNCTION piggyvest_primary_card.select_stale_ready_checkouts(authority jsonb, stale_before timestamptz, maximum integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected jsonb;
BEGIN
  IF maximum IS NULL OR maximum < 1 OR maximum > 25 THEN RAISE EXCEPTION 'bounded selection required' USING ERRCODE='22023'; END IF;
  IF stale_before IS NULL THEN RAISE EXCEPTION 'stale cutoff required' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(authority) IS DISTINCT FROM 'object'
    OR authority <> jsonb_build_object('integrationId',authority->'integrationId','merchantId',authority->'merchantId',
      'environment',authority->'environment','businessId',authority->'businessId',
      'expiresAt',authority->'expiresAt','callbackUrl',authority->'callbackUrl')
  THEN RAISE EXCEPTION 'invalid checkout authority' USING ERRCODE='42501'; END IF;
  PERFORM config.integration_id FROM piggyvest_primary_card.settings config
  JOIN piggyvest_primary.integrations integration ON integration.id=config.integration_id AND integration.merchant_id=config.merchant_id
  WHERE config.integration_id=(authority->>'integrationId')::uuid
    AND config.merchant_id=(authority->>'merchantId')::uuid AND config.environment=authority->>'environment'
    AND config.business_id=authority->>'businessId' AND integration.business_id=config.business_id
    AND integration.environment=config.environment AND integration.enabled AND config.enabled
    AND config.expires_at=(authority->>'expiresAt')::timestamptz
    AND config.callback_url=authority->>'callbackUrl'
    AND SESSION_USER=config.evidence_login
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(candidate.intent ORDER BY candidate.updated_at, candidate.id),'[]'::jsonb) INTO selected FROM (
    SELECT operation.id, operation.updated_at,
      piggyvest_primary_card.project(operation)
      || jsonb_build_object('expiresAt', settings.expires_at, 'callbackUrl', settings.callback_url) AS intent
    FROM piggyvest_primary_card.operations operation
    JOIN piggyvest_primary_card.settings settings ON settings.integration_id=operation.integration_id
    WHERE operation.integration_id=(authority->>'integrationId')::uuid
      AND operation.environment=authority->>'environment'
      AND operation.merchant_id=(authority->>'merchantId')::uuid
      AND operation.business_id=authority->>'businessId'
      AND operation.state='ready'
      AND operation.updated_at < stale_before
    ORDER BY operation.updated_at, operation.id LIMIT maximum
  ) candidate;
  RETURN selected;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.select_stale_ready_checkouts(jsonb,timestamptz,integer)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.select_stale_ready_checkouts(jsonb,timestamptz,integer) TO primary_card_evidence;
COMMIT;
