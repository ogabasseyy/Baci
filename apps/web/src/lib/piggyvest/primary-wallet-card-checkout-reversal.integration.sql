\set ON_ERROR_STOP on
\ir primary-wallet-card-custody-settlement-fence.integration.sql
\ir ../../../../../supabase/migrations/20261008092300_primary_card_expiry_drain.sql
\ir ../../../../../supabase/migrations/20261008094500_primary_card_checkout_reversals.sql
-- Reversal conformance: Paystack refund/dispute webhooks land in
-- checkout_reversals and fence the ledger. The fence chain above ends
-- post-expiry ('third' settled, 'fourth' collected-but-unsettled), so
-- every block below also proves the evidence drain: reversals record
-- after the deadline that blocks only NEW reservations.
INSERT INTO public.customers VALUES('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','fifth@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',repeat('e',64),'verified','fifth@example.test','fifth@example.test-wallet');
CREATE TABLE public.reversal_fixture(label text PRIMARY KEY,scope jsonb,operation_id uuid);
GRANT SELECT,UPDATE ON public.reversal_fixture TO baci_primary_card_authorizer,baci_primary_card_evidence;
INSERT INTO public.reversal_fixture(label,scope)
SELECT 'fifth@example.test',original.scope||jsonb_build_object('customerId','50000000-0000-4000-8000-000000000002','userId','50000000-0000-4000-8000-000000000003','email','fifth@example.test')
FROM public.card_fixture original WHERE original.scope->>'email'='customer@example.test';
-- The fence chain consumed the daily treasury cap (third + fourth);
-- backdate those reservations so the reversal fixtures run as a new
-- day. The reserved-state cap still binds the new operations below.
UPDATE piggyvest_primary_card.reservations SET created_at=created_at-interval '2 days';
-- Reserve pre-expiry (reserve keeps the strict deadline), then restore
-- the expired deadline: everything after this runs post-expiry.
UPDATE piggyvest_primary_card.settings SET expires_at='2099-01-01T00:00:00Z'
  WHERE integration_id='10000000-0000-4000-8000-000000000004';
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT fixture.scope FROM public.reversal_fixture fixture WHERE label='fifth@example.test');
  intent jsonb;
  claim jsonb;
BEGIN
  intent := piggyvest_primary_card.reserve(scope,jsonb_build_object('idempotencyKey','50000000-0000-4000-8000-000000000009','amountKobo',25000,'consent',jsonb_build_object('version','primary-wallet-card-v1','oneTimeCharge',true,'saveCard',false)));
  UPDATE public.reversal_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label='fifth@example.test';
  claim := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  IF NOT piggyvest_primary_card.record_initialization(scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,
    jsonb_build_object('reference','pvb-first-primary-'||(intent->>'operationId'),'authorizationUrl','https://checkout.paystack.com/abc123')) THEN
    RAISE EXCEPTION 'reversal fixture not ready';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.settings SET expires_at='2020-01-01T00:00:00Z'
  WHERE integration_id='10000000-0000-4000-8000-000000000004';
-- Uncollected reversal: records post-expiry, abandons the checkout,
-- releases treasury, and replays idempotently.
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  fixture record;
  scope jsonb;
  payload jsonb;
BEGIN
  SELECT * INTO fixture FROM public.reversal_fixture WHERE label='fifth@example.test';
  -- The drain binds the presented deadline to the stored one: post-expiry
  -- callers present the known stored deadline.
  scope := fixture.scope||'{"expiresAt":"2020-01-01T00:00:00Z"}';
  payload := jsonb_build_object('event','refund.processed','kind','refund','amountKobo',25000,'currency','NGN','status','processed',
    'transactionReference','pvb-first-primary-'||fixture.operation_id);
  IF piggyvest_primary_card.record_checkout_reversal(scope,fixture.operation_id,'refund','evt-refund-fifth-1',payload)->>'outcome'<>'recorded' THEN
    RAISE EXCEPTION 'uncollected reversal not recorded';
  END IF;
  IF piggyvest_primary_card.record_checkout_reversal(scope,fixture.operation_id,'refund','evt-refund-fifth-1',payload)->>'outcome'<>'duplicate' THEN
    RAISE EXCEPTION 'reversal replay not idempotent';
  END IF;
  IF piggyvest_primary_card.record_checkout_reversal(scope,fixture.operation_id,'refund','evt-refund-fifth-2',payload)->>'outcome'<>'recorded' THEN
    RAISE EXCEPTION 'second reversal event not recorded';
  END IF;
  BEGIN
    PERFORM piggyvest_primary_card.record_checkout_reversal(scope||'{"merchantId":"00000000-0000-4000-8000-000000000000"}',
      fixture.operation_id,'refund','evt-refund-fifth-3',payload);
    RAISE EXCEPTION 'tampered scope recorded reversal';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.record_checkout_reversal(
      (SELECT custody.scope FROM public.custody_fixture custody WHERE label='fourth@example.test')||'{"expiresAt":"2020-01-01T00:00:00Z"}',
      fixture.operation_id,'refund','evt-refund-fifth-4',payload);
    RAISE EXCEPTION 'cross-customer scope recorded reversal';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.record_checkout_reversal(scope,fixture.operation_id,'refund','evt-refund-fifth-5',
      jsonb_set(payload,'{transactionReference}','"pvb-first-primary-10000000-0000-4000-8000-000000000005"'));
    RAISE EXCEPTION 'mismatched reference recorded reversal';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.record_collection(scope,fixture.operation_id,
      jsonb_build_object('reference','pvb-first-primary-'||fixture.operation_id,'amountKobo',25000,'domain','test','providerTransactionId','12349','token',NULL));
    RAISE EXCEPTION 'late collection resurrected reversed checkout';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ DECLARE
  reversed_id uuid := (SELECT fixture.operation_id FROM public.reversal_fixture fixture WHERE label='fifth@example.test');
BEGIN
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=reversed_id)<>'abandoned' THEN RAISE EXCEPTION 'reversed checkout not abandoned'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.reservations WHERE reservations.operation_id=reversed_id)<>'released' THEN RAISE EXCEPTION 'reversed checkout leaked treasury'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary_card.checkout_reversals WHERE checkout_reversals.operation_id=reversed_id)<>2 THEN RAISE EXCEPTION 'reversal rows not exact'; END IF;
END $$;
-- The abandoned slot frees the customer for a fresh checkout.
UPDATE piggyvest_primary_card.settings SET expires_at='2099-01-01T00:00:00Z'
  WHERE integration_id='10000000-0000-4000-8000-000000000004';
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT fixture.scope FROM public.reversal_fixture fixture WHERE label='fifth@example.test');
  intent jsonb;
BEGIN
  intent := piggyvest_primary_card.reserve(scope,jsonb_build_object('idempotencyKey','50000000-0000-4000-8000-00000000000a','amountKobo',25000,'consent',jsonb_build_object('version','primary-wallet-card-v1','oneTimeCharge',true,'saveCard',false)));
  IF (intent->>'operationId')::uuid=(SELECT fixture.operation_id FROM public.reversal_fixture fixture WHERE label='fifth@example.test') THEN
    RAISE EXCEPTION 'reversal did not free unresolved slot';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.settings SET expires_at='2020-01-01T00:00:00Z'
  WHERE integration_id='10000000-0000-4000-8000-000000000004';
-- Collected reversal: a dispute against the custody-pending 'fourth'
-- checkout records without mutating it, and settlement returns
-- 'conflict' instead of crediting — no wallet movement, no treasury
-- consumption, no completion.
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  fixture record;
  payload jsonb;
BEGIN
  SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
  payload := jsonb_build_object('event','charge.dispute.create','kind','dispute','amountKobo',25000,'currency','NGN','status','pending',
    'transactionReference','pvb-first-primary-'||fixture.operation_id);
  IF piggyvest_primary_card.record_checkout_reversal(fixture.scope||'{"expiresAt":"2020-01-01T00:00:00Z"}',fixture.operation_id,'dispute','evt-dispute-fourth-1',payload)->>'outcome'<>'recorded' THEN
    RAISE EXCEPTION 'collected reversal not recorded';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE
  inbox record;
  envelope jsonb;
  raw text;
  claims jsonb;
  claim jsonb;
  digest text;
  proof jsonb;
BEGIN
  SELECT * INTO inbox FROM public.fence_fixture WHERE label='fourth@example.test';
  envelope := inbox.envelope||'{"eventId":"reversal-settle-fourth"}';
  raw := encode(convert_to(envelope::text,'UTF8'),'hex');
  IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,raw,repeat('a',128))<>'accepted' THEN
    RAISE EXCEPTION 'reversal settle intake failed';
  END IF;
  claims := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,10);
  SELECT value INTO claim FROM jsonb_array_elements(claims) value WHERE value->>'eventId'='reversal-settle-fourth';
  IF claim IS NULL THEN RAISE EXCEPTION 'reversal settle claim missing'; END IF;
  digest := encode(sha256(decode(raw,'hex')),'hex');
  proof := (SELECT custody.proof FROM public.custody_fixture custody WHERE label='fourth@example.test')
    ||jsonb_build_object('observedAt',clock_timestamp(),'bodyDigest',digest,'inboxToken',claim->>'token','eventId','reversal-settle-fourth');
  IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof)<>'conflict' THEN
    RAISE EXCEPTION 'reversed custody settled';
  END IF;
  IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,'reversal-settle-fourth',(claim->>'token')::uuid,'conflict') THEN
    RAISE EXCEPTION 'reversal conflict not acknowledged';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_primary_card.checkout_reversals)<>3 THEN RAISE EXCEPTION 'reversal tally wrong'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary_card.settlements)<>1 THEN RAISE EXCEPTION 'reversal leaked settlement'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=(SELECT operation_id FROM public.custody_fixture WHERE label='fourth@example.test'))<>'custody_pending' THEN RAISE EXCEPTION 'collected reversal mutated operation'; END IF;
  IF (SELECT available_balance FROM public.customer_wallets WHERE customer_id='40000000-0000-4000-8000-000000000002')<>292 THEN RAISE EXCEPTION 'reversed settlement moved wallet'; END IF;
  IF EXISTS(SELECT 1 FROM public.customer_wallet_transactions WHERE customer_id='40000000-0000-4000-8000-000000000002' AND source_type='piggyvest_primary_card_custody') THEN RAISE EXCEPTION 'reversed settlement credited wallet'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.transfer_outbox WHERE operation_id=(SELECT operation_id FROM public.custody_fixture WHERE label='fourth@example.test'))='completed' THEN RAISE EXCEPTION 'reversed settlement completed outbox'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary_card.operations WHERE customer_id='50000000-0000-4000-8000-000000000002' AND state='reserved')<>1 THEN RAISE EXCEPTION 're-reserve missing'; END IF;
  IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>60000 THEN RAISE EXCEPTION 'reversal treasury tally wrong'; END IF;
  IF (SELECT consumed_kobo FROM prefunded_card.treasury_bindings)<>45000 THEN RAISE EXCEPTION 'reversal consumed treasury'; END IF;
END $$;
