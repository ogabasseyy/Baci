BEGIN;

CREATE SCHEMA prefunded_card;
REVOKE ALL ON SCHEMA prefunded_card FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE prefunded_card.treasury_bindings (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  expected_business_id text COLLATE "C" NOT NULL,
  source_wallet_id text COLLATE "C" NOT NULL,
  currency text COLLATE "C" NOT NULL CHECK (currency = 'NGN'),
  verified_available_kobo bigint NOT NULL CHECK (verified_available_kobo >= 0),
  reserved_kobo bigint NOT NULL DEFAULT 0 CHECK (reserved_kobo >= 0),
  consumed_kobo bigint NOT NULL DEFAULT 0 CHECK (consumed_kobo >= 0),
  verified_at timestamptz NOT NULL,
  authorized_login name NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  CHECK (source_wallet_id <> ''),
  CHECK (expected_business_id <> '')
);

CREATE TABLE prefunded_card.operations (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  request_fingerprint text COLLATE "C" NOT NULL,
  idempotency_key text COLLATE "C" NOT NULL,
  saved_method_id uuid NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  fee_allowance_kobo bigint NOT NULL CHECK (fee_allowance_kobo = 0),
  currency text COLLATE "C" NOT NULL CHECK (currency = 'NGN'),
  collection_reference text COLLATE "C" NOT NULL,
  transfer_reference text COLLATE "C" NOT NULL,
  destination_wallet_id text COLLATE "C" NOT NULL,
  destination_customer_id text COLLATE "C" NOT NULL,
  collection_status text NOT NULL DEFAULT 'not_started' CHECK (collection_status IN ('not_started','dispatching','action_required','pending','unknown','verified_success','verified_failed','reversed')),
  transfer_status text NOT NULL DEFAULT 'not_started' CHECK (transfer_status IN ('not_started','dispatching','pending','unknown','verified_success','verified_failed')),
  projection_status text NOT NULL DEFAULT 'unapplied' CHECK (projection_status IN ('unapplied','applied','reconciliation_required')),
  collection_fence bigint NOT NULL DEFAULT 0 CHECK (collection_fence >= 0),
  transfer_fence bigint NOT NULL DEFAULT 0 CHECK (transfer_fence >= 0),
  verification_fence bigint NOT NULL DEFAULT 0 CHECK (verification_fence >= 0),
  verification_token uuid,
  verification_lease_expires_at timestamptz,
  collection_attempted_at timestamptz,
  transfer_attempted_at timestamptz,
  collection_provider_transaction_id text COLLATE "C",
  transfer_provider_transaction_id text COLLATE "C",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id, idempotency_key),
  UNIQUE (integration_id, collection_reference),
  UNIQUE (integration_id, transfer_reference),
  UNIQUE (integration_id, collection_provider_transaction_id),
  UNIQUE (integration_id, transfer_provider_transaction_id),
  FOREIGN KEY (integration_id, merchant_id, customer_id, goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id, merchant_id, customer_id, goal_id),
  CHECK (collection_reference <> transfer_reference),
  CHECK (destination_wallet_id <> ''),
  CHECK (destination_customer_id <> '')
);

CREATE INDEX prefunded_card_operations_goal_active_idx ON prefunded_card.operations(goal_id)
  WHERE collection_status NOT IN ('verified_failed','reversed');

ALTER TABLE prefunded_card.treasury_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA prefunded_card FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION prefunded_card.guard_operation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'prefunded card immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['collection_status','transfer_status','projection_status','collection_fence','transfer_fence','verification_fence','verification_token','verification_lease_expires_at','collection_attempted_at','transfer_attempted_at','collection_provider_transaction_id','transfer_provider_transaction_id'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['collection_status','transfer_status','projection_status','collection_fence','transfer_fence','verification_fence','verification_token','verification_lease_expires_at','collection_attempted_at','transfer_attempted_at','collection_provider_transaction_id','transfer_provider_transaction_id']) THEN
    RAISE EXCEPTION 'prefunded card immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_card_operation_guard BEFORE UPDATE OR DELETE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_operation();
CREATE TRIGGER prefunded_card_operation_no_truncate BEFORE TRUNCATE ON prefunded_card.operations
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_operation();

CREATE FUNCTION prefunded_card.reserve(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE command prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE; mapped record; existing prefunded_card.operations%ROWTYPE;
DECLARE active_goal_kobo bigint; available_goal_kobo bigint; available_float_kobo bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'prefunded reservation isolation denied' USING ERRCODE='42501';
  END IF;
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_command)) <> 16
    OR NOT p_command ?& ARRAY['operationId','integrationId','merchantId','customerId','goalId','treasuryBindingId','requestFingerprint','idempotencyKey','savedMethodId','amountKobo','feeAllowanceKobo','currency','collectionReference','transferReference','destinationWalletId','destinationCustomerId']
    OR (p_command->>'feeAllowanceKobo')::bigint <> 0 OR p_command->>'currency' <> 'NGN'
    OR (p_command->>'amountKobo')::bigint NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid prefunded card command' USING ERRCODE = '22023';
  END IF;
  command.id := (p_command->>'operationId')::uuid; command.integration_id := (p_command->>'integrationId')::uuid;
  command.merchant_id := (p_command->>'merchantId')::uuid; command.customer_id := (p_command->>'customerId')::uuid;
  command.goal_id := (p_command->>'goalId')::uuid; command.treasury_binding_id := (p_command->>'treasuryBindingId')::uuid;
  command.request_fingerprint := p_command->>'requestFingerprint'; command.idempotency_key := p_command->>'idempotencyKey';
  command.saved_method_id := (p_command->>'savedMethodId')::uuid; command.amount_kobo := (p_command->>'amountKobo')::bigint;
  command.fee_allowance_kobo := 0; command.currency := 'NGN'; command.collection_reference := p_command->>'collectionReference';
  command.transfer_reference := p_command->>'transferReference'; command.destination_wallet_id := p_command->>'destinationWalletId';
  command.destination_customer_id := p_command->>'destinationCustomerId';
  IF length(command.request_fingerprint) NOT BETWEEN 16 AND 255 OR length(command.idempotency_key) NOT BETWEEN 16 AND 255
    OR command.collection_reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR command.transfer_reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR command.collection_reference = command.transfer_reference OR command.destination_wallet_id = '' OR command.destination_customer_id = '' THEN
    RAISE EXCEPTION 'invalid prefunded card command' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id = command.treasury_binding_id
    AND integration_id = command.integration_id AND merchant_id = command.merchant_id AND enabled FOR UPDATE;
  IF NOT FOUND OR binding.authorized_login <> session_user OR binding.verified_at < clock_timestamp() - interval '15 minutes' OR binding.verified_at > clock_timestamp() + interval '1 minute' OR binding.currency <> command.currency OR binding.source_wallet_id = command.destination_wallet_id THEN
    RAISE EXCEPTION 'prefunded card treasury denied' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=command.integration_id AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card integration denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM prefunded_card.operations WHERE integration_id = command.integration_id AND idempotency_key = command.idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF to_jsonb(existing) @> jsonb_build_object('id',command.id,'integration_id',command.integration_id,'merchant_id',command.merchant_id,'customer_id',command.customer_id,'goal_id',command.goal_id,'treasury_binding_id',command.treasury_binding_id,'request_fingerprint',command.request_fingerprint,'idempotency_key',command.idempotency_key,'saved_method_id',command.saved_method_id,'amount_kobo',command.amount_kobo,'fee_allowance_kobo',command.fee_allowance_kobo,'currency',command.currency,'collection_reference',command.collection_reference,'transfer_reference',command.transfer_reference,'destination_wallet_id',command.destination_wallet_id,'destination_customer_id',command.destination_customer_id) THEN
      RETURN jsonb_build_object('operationId',existing.id,'outcome','reserved','collectionStatus',existing.collection_status,'transferStatus',existing.transfer_status);
    END IF;
    RAISE EXCEPTION 'prefunded card idempotency conflict' USING ERRCODE = '23505';
  END IF;
  PERFORM goal_id FROM piggyvest_savings_ledger.bindings WHERE goal_id = command.goal_id AND integration_id = command.integration_id
    AND merchant_id = command.merchant_id AND customer_id = command.customer_id AND enabled AND authorized_login=session_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card scope denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO mapped FROM piggyvest_staging.wallet_goal_mappings WHERE integration_id = command.integration_id AND goal_id = command.goal_id
    AND merchant_id = command.merchant_id AND customer_id = command.customer_id AND provider_wallet_id = command.destination_wallet_id
    AND provider_customer_id = command.destination_customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card destination mismatch' USING ERRCODE = '23514'; END IF;
  PERFORM pm.id FROM public.customer_saved_payment_methods pm WHERE pm.id=command.saved_method_id AND pm.merchant_id=command.merchant_id AND pm.customer_id=command.customer_id AND pm.provider='paystack' AND pm.reusable AND pm.is_active AND pm.disabled_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card saved method denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id = command.goal_id AND merchant_id = command.merchant_id
    AND customer_id = command.customer_id AND status = 'active' AND completed_at IS NULL AND cancelled_at IS NULL AND spent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card goal denied' USING ERRCODE = '23514'; END IF;
  SELECT coalesce(sum(amount_kobo),0) INTO active_goal_kobo FROM prefunded_card.operations WHERE goal_id = command.goal_id
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  available_goal_kobo := ((goal.target_amount - goal.current_amount) * 100)::bigint - active_goal_kobo;
  available_float_kobo := binding.verified_available_kobo - binding.reserved_kobo - binding.consumed_kobo;
  IF available_goal_kobo < command.amount_kobo THEN RAISE EXCEPTION 'prefunded card goal capacity insufficient' USING ERRCODE = '23514'; END IF;
  IF available_float_kobo < command.amount_kobo THEN RAISE EXCEPTION 'prefunded card float insufficient' USING ERRCODE = '23514'; END IF;
  INSERT INTO prefunded_card.operations (id,integration_id,merchant_id,customer_id,goal_id,treasury_binding_id,
    request_fingerprint,idempotency_key,saved_method_id,amount_kobo,fee_allowance_kobo,currency,collection_reference,
    transfer_reference,destination_wallet_id,destination_customer_id)
    VALUES (command.id,command.integration_id,command.merchant_id,command.customer_id,command.goal_id,command.treasury_binding_id,
      command.request_fingerprint,command.idempotency_key,command.saved_method_id,command.amount_kobo,command.fee_allowance_kobo,
      command.currency,command.collection_reference,command.transfer_reference,command.destination_wallet_id,command.destination_customer_id)
    ;
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo = reserved_kobo + command.amount_kobo WHERE id = binding.id;
  RETURN jsonb_build_object('operationId',command.id,'outcome','reserved','collectionStatus','not_started','transferStatus','not_started');
END $$;


REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prefunded_card FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON SCHEMA prefunded_card IS 'Staging-only durable reservation and dispatch fencing. It never posts the canonical savings ledger or projects a contribution.';
COMMIT;
