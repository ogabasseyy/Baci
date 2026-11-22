\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/verified-funding-setup.inc.sql
BEGIN;
CREATE TEMP TABLE verified_funding_cases (kind text PRIMARY KEY, ids jsonb NOT NULL);
INSERT INTO verified_funding_cases VALUES
  ('credit_direct',pg_temp.verified_funding_fixture('credit_direct')),
  ('mixed_legacy',pg_temp.verified_funding_fixture('bank_transfer',true)),
  ('same_price_cash',pg_temp.verified_funding_fixture('cash',false,0)),
  ('same_price_unknown',pg_temp.verified_funding_fixture('synthetic_new_gateway',false,0)),
  ('lower_price',pg_temp.verified_funding_fixture('credit_direct',false,-2000000)),
  ('paused',pg_temp.verified_funding_fixture('credit_direct')),
  ('funding_mismatch',pg_temp.verified_funding_fixture('credit_direct')),
  ('duplicate_transfer',pg_temp.verified_funding_fixture('credit_direct'));
UPDATE private.paid_order_amendment_config SET enabled = false
WHERE merchant_id = (SELECT (ids->>'merchant')::uuid FROM verified_funding_cases WHERE kind = 'paused');
UPDATE public.transactions SET amount = amount - 1
WHERE id = (SELECT (ids#>>'{captureIds,0}')::uuid FROM verified_funding_cases WHERE kind = 'funding_mismatch');
SELECT public.register_paid_order_bank_evidence(config.bank_account_id,'SYNTHETIC-DUPLICATE','incoming',
  2000000,now()-interval '1 minute','separate exact-amount statement credit',NULL,(fixture.ids->>'order')::uuid)
FROM verified_funding_cases fixture
JOIN private.paid_order_amendment_config config ON config.merchant_id = (fixture.ids->>'merchant')::uuid
WHERE fixture.kind = 'duplicate_transfer';
GRANT SELECT, UPDATE ON verified_funding_cases TO authenticated;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  fixture verified_funding_cases%ROWTYPE;
  order_id uuid;
  quote jsonb;
  payload jsonb;
  snapshot jsonb;
BEGIN
  FOR fixture IN SELECT * FROM verified_funding_cases LOOP
    order_id := (fixture.ids->>'order')::uuid;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    BEGIN
      PERFORM public.preview_paid_order_amendment(order_id,jsonb_build_object(
        'lineId',fixture.ids->>'line','replacement',jsonb_build_object('kind','variant','id',fixture.ids->>'variant')));
      RAISE EXCEPTION 'cross-tenant preview was accepted';
    EXCEPTION WHEN no_data_found THEN
      IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claim.sub',fixture.ids->>'actor',true);
    IF fixture.kind IN ('paused','lower_price','funding_mismatch','duplicate_transfer') THEN
      IF fixture.kind = 'paused'
        AND public.read_paid_order_amendment_workspace(order_id)->>'canStart' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'paused swap is visible in the order workspace';
      END IF;
      BEGIN
        PERFORM public.preview_paid_order_amendment(order_id,jsonb_build_object(
          'lineId',fixture.ids->>'line','replacement',jsonb_build_object('kind','variant','id',fixture.ids->>'variant')));
        RAISE EXCEPTION 'unqualified preview was accepted';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM (CASE fixture.kind
          WHEN 'paused' THEN 'scenario_disabled'
          WHEN 'lower_price' THEN 'verified_funding_refund_review_required'
          WHEN 'funding_mismatch' THEN 'amendment_ineligible'
          WHEN 'duplicate_transfer' THEN 'amendment_payment_open'
        END) THEN RAISE; END IF;
      END;
      CONTINUE;
    END IF;
    IF public.read_paid_order_amendment_workspace(order_id)->>'canStart' IS DISTINCT FROM 'true'
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(public.search_paid_order_amendment_replacements(
          order_id,(fixture.ids->>'line')::uuid,'Tecno Pop 20')) candidate
        WHERE candidate->>'id' = fixture.ids->>'variant'
          AND candidate->>'label' = 'Tecno Pop 20 · 3 GB / 64 GB'
      ) THEN RAISE EXCEPTION 'verified-funds order workspace or replacement search is unavailable'; END IF;
    quote := public.preview_paid_order_amendment(order_id,jsonb_build_object(
      'lineId',fixture.ids->>'line','replacement',jsonb_build_object('kind','variant','id',fixture.ids->>'variant')));
    payload := jsonb_build_object('previewId',quote->>'previewId','customerAgreed',true,
      'reason','Synthetic supported swap','idempotencyKey','verified-funds-fixture');
    IF fixture.kind IN ('same_price_cash','same_price_unknown') THEN
      IF (quote->>'adjustmentMinor')::bigint IS DISTINCT FROM 0::bigint
        OR jsonb_array_length(quote->'bankEvidence') IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'incorrect same-price verified-funds quote: %',quote;
      END IF;
      snapshot := public.confirm_paid_order_amendment(order_id,payload);
      IF snapshot->>'state' IS DISTINCT FROM 'settled'
        OR public.confirm_paid_order_amendment(order_id,payload) IS DISTINCT FROM snapshot THEN
        RAISE EXCEPTION 'same-price verified-funds swap failed: %',snapshot;
      END IF;
      CONTINUE;
    END IF;
    IF (quote->>'adjustmentMinor')::bigint IS DISTINCT FROM 2000000::bigint
      OR jsonb_array_length(quote->'bankEvidence') IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'incorrect verified-funds quote: %',quote;
    END IF;
    BEGIN
      PERFORM public.confirm_paid_order_amendment(order_id,payload);
      RAISE EXCEPTION 'confirmation without proof was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_evidence_required' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.confirm_paid_order_amendment(order_id,
        payload || jsonb_build_object('bankEvidenceId',gen_random_uuid()));
      RAISE EXCEPTION 'confirmation with unverified transfer was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_evidence_required' THEN RAISE; END IF;
    END;
    payload := payload || jsonb_build_object('bankEvidenceId',fixture.ids->>'bankEvidenceId');
    snapshot := public.confirm_paid_order_amendment(order_id,payload);
    IF snapshot->>'state' IS DISTINCT FROM 'settled'
      OR (snapshot->>'balanceDueMinor')::bigint IS DISTINCT FROM 0::bigint
      OR public.confirm_paid_order_amendment(order_id,payload) IS DISTINCT FROM snapshot THEN
      RAISE EXCEPTION 'confirmed swap or exact replay failed: %',snapshot;
    END IF;
  END LOOP;
END;
$$;
RESET ROLE;

DO $$
DECLARE
  f verified_funding_cases%ROWTYPE;
  o uuid;
  a uuid;
  original jsonb;
  revised jsonb;
BEGIN
  FOR f IN SELECT * FROM verified_funding_cases WHERE kind IN ('credit_direct','mixed_legacy') LOOP
    o := (f.ids->>'order')::uuid;
    SELECT id INTO STRICT a FROM private.paid_order_amendments
    WHERE order_id = o AND settlement_route = 'verified_funds';
    IF (SELECT amount_paid FROM public.orders WHERE id = o) IS DISTINCT FROM 149867.50::numeric
      OR (SELECT status FROM public.variant_inventory WHERE id = (f.ids->>'oldUnit')::uuid) IS DISTINCT FROM 'available'
      OR (SELECT order_item_id FROM public.variant_inventory WHERE id = (f.ids->>'newUnit')::uuid)
        IS DISTINCT FROM (f.ids->>'line')::uuid
      OR (SELECT count(*) FROM public.transactions WHERE order_id = o AND gateway = 'manual'
          AND amount = 20000 AND metadata->>'paid_order_amendment_id' = a::text) <> 1
      OR NOT EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
          WHERE id = (f.ids->>'bankEvidenceId')::uuid AND order_id = o AND allocation = 'top_up')
      OR (SELECT count(*) FROM private.paid_order_amendment_events
          WHERE amendment_id = a AND event_type IN ('confirmed','top_up_recorded')) <> 2
      OR (SELECT count(*) FROM private.variant_inventory_events
          WHERE order_id = o AND inventory_unit_id = (f.ids->>'oldUnit')::uuid
            AND event_type = 'reservation_released') <> 1
      OR (SELECT count(*) FROM private.variant_inventory_events
          WHERE order_id = o AND inventory_unit_id = (f.ids->>'newUnit')::uuid
            AND event_type = 'hold_confirmed') <> 1
      OR (SELECT count(*) FROM private.paid_order_amendment_documents WHERE amendment_id = a) <> 1
      OR (SELECT count(*) FROM private.paid_order_amendment_updates u
          JOIN private.paid_order_amendment_documents d ON d.id = u.document_id
          WHERE d.amendment_id = a AND u.state = 'pending') <> 1 THEN
      RAISE EXCEPTION 'verified-funds order, inventory, funding or history drift';
    END IF;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',f.ids->>'actor',true);
    original := public.read_paid_order_amendment_document(o,'original');
    revised := public.read_paid_order_amendment_document(o,'current');
    IF original#>>'{inputs,items,0,name}' IS DISTINCT FROM 'Tecno Pop 10'
      OR revised#>>'{inputs,items,0,name}' IS DISTINCT FROM 'Tecno Pop 20'
      OR revised#>>'{inputs,items,0,variant_name}' IS DISTINCT FROM '3 GB / 64 GB'
      OR (revised#>>'{inputs,order,amount_paid}')::numeric IS DISTINCT FROM 149867.50::numeric
      OR (SELECT count(*) FROM jsonb_array_elements(revised#>'{inputs,payments}') payment
          WHERE (payment->>'amount')::numeric = 20000 AND payment->>'payment_method' = 'bank_transfer') <> 1
      OR jsonb_array_length(revised#>'{inputs,payments}')
        IS DISTINCT FROM jsonb_array_length(f.ids->'captureIds') + 1 THEN
      RAISE EXCEPTION 'incorrect invoice projections';
    END IF;
    BEGIN
      PERFORM public.cancel_order_as_merchant(o,'Synthetic cancellation check','automatic');
      RAISE EXCEPTION 'unqualified cancellation was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'verified_funding_refund_review_required' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;
ROLLBACK;
