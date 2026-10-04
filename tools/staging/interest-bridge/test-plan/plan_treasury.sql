CREATE FUNCTION pg_temp.plan_treasury(payload jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57' AND enabled
      AND verified_available_kobo=10000 AND reserved_kobo=0 AND consumed_kobo=0)
    OR (SELECT sum(verified_available_kobo) FROM prefunded_card.treasury_bindings) IS DISTINCT FROM 10000::numeric
    OR (SELECT sum(reserved_kobo) FROM prefunded_card.treasury_bindings) IS DISTINCT FROM 0::numeric
    OR (SELECT sum(consumed_kobo) FROM prefunded_card.treasury_bindings) IS DISTINCT FROM 0::numeric
    OR EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings WHERE verified_available_kobo<0
      OR reserved_kobo<0 OR consumed_kobo<0) THEN
    RAISE EXCEPTION 'test plan treasury cap refused';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_identities
      WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
      AND integration_id=(payload->>'integrationId')::uuid AND merchant_id=(payload->>'merchantId')::uuid
      AND expected_business_id=payload->>'businessId' AND source_wallet_id='01M238A0V75387H4HZ15YFWGX3'
      AND authorized_login='prefunded_treasury_operator')
    OR (SELECT sum(opening_available_kobo) FROM prefunded_card.treasury_identities)
      +coalesce((SELECT sum(amount_kobo) FROM prefunded_card.treasury_replenishments),0)
      IS DISTINCT FROM 10000::numeric
    OR EXISTS(SELECT 1 FROM prefunded_card.treasury_identities identity
      LEFT JOIN prefunded_card.treasury_bindings binding ON binding.id=identity.treasury_binding_id
      WHERE identity.opening_available_kobo IS NULL OR identity.opening_available_kobo<=0
      OR binding.verified_available_kobo IS DISTINCT FROM identity.opening_available_kobo::numeric
        +coalesce((SELECT sum(amount_kobo) FROM prefunded_card.treasury_replenishments
          WHERE treasury_binding_id=identity.treasury_binding_id),0))
    OR EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings binding
      WHERE NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_identities identity
        WHERE identity.treasury_binding_id=binding.id))
    OR EXISTS(SELECT 1 FROM prefunded_card.treasury_replenishments replenishment
      WHERE replenishment.amount_kobo IS NULL OR replenishment.amount_kobo<=0
      OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_identities identity
        WHERE identity.treasury_binding_id=replenishment.treasury_binding_id)) THEN
    RAISE EXCEPTION 'test plan treasury cap refused';
  END IF;
END $$;
