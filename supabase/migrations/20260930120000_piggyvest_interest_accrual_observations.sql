BEGIN;

CREATE TABLE piggyvest_staging.interest_accrual_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  provider_business_id text NOT NULL,
  provider_wallet_id text COLLATE "C" NOT NULL,
  provider_customer_id text COLLATE "C" NOT NULL,
  provider_accrual_id text COLLATE "C" NOT NULL,
  internal_wallet_id text NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  interest_date timestamptz NOT NULL,
  interest_type text NOT NULL CHECK (interest_type IN ('original', 'differential')),
  split_destination_wallet_id text,
  amount_lexeme text NOT NULL,
  amount_kobo numeric NOT NULL CHECK (amount_kobo >= 0),
  economics jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id, provider_wallet_id, provider_accrual_id),
  FOREIGN KEY (integration_id, provider_wallet_id)
    REFERENCES piggyvest_staging.wallet_goal_mappings(integration_id, provider_wallet_id)
);
CREATE INDEX interest_accrual_observations_merchant_idx ON piggyvest_staging.interest_accrual_observations(merchant_id);
CREATE INDEX interest_accrual_observations_customer_idx
  ON piggyvest_staging.interest_accrual_observations(customer_id, merchant_id, interest_date DESC, id);
CREATE INDEX interest_accrual_observations_goal_idx ON piggyvest_staging.interest_accrual_observations(goal_id);

CREATE TABLE piggyvest_staging.interest_accrual_receipts (
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  event_id text COLLATE "C" NOT NULL,
  observation_id uuid NOT NULL REFERENCES piggyvest_staging.interest_accrual_observations(id),
  receipt_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (integration_id, event_id),
  UNIQUE (integration_id, receipt_id)
);
CREATE INDEX interest_accrual_receipts_observation_idx ON piggyvest_staging.interest_accrual_receipts(observation_id);
ALTER TABLE piggyvest_staging.interest_accrual_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_staging.interest_accrual_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON piggyvest_staging.interest_accrual_observations,
  piggyvest_staging.interest_accrual_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_staging.reject_interest_accrual_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'interest accrual observation immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER interest_accrual_observations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON piggyvest_staging.interest_accrual_observations FOR EACH STATEMENT
  EXECUTE FUNCTION piggyvest_staging.reject_interest_accrual_mutation();
CREATE TRIGGER interest_accrual_receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON piggyvest_staging.interest_accrual_receipts FOR EACH STATEMENT
  EXECUTE FUNCTION piggyvest_staging.reject_interest_accrual_mutation();
REVOKE ALL ON FUNCTION piggyvest_staging.reject_interest_accrual_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_staging.record_interest_accrual(
  p_integration uuid, p_business text, p_system_id text, p_receipt_id uuid,
  p_payload_sha256 text, p_payload json
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  detail json;
  field text;
  provider_event_id text;
  public_wallet text;
  provider_customer text;
  accrual_id text;
  accrual_date timestamptz;
  split_destination text;
  amount_text text;
  amount numeric;
  economics jsonb;
  mapping piggyvest_staging.wallet_goal_mappings%ROWTYPE;
  stored record;
  observation_id uuid;
  duplicate_observation boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR session_user <> 'piggyvest_staging_ledger_worker'
    OR p_system_id IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'interest accrual identity refused' USING ERRCODE = '42501';
  END IF;
  IF p_integration IS NULL OR p_business IS NULL OR octet_length(p_business) NOT BETWEEN 1 AND 512
    OR p_receipt_id IS NULL OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR json_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text) > 65536
    OR p_payload_sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(p_payload::text, 'UTF8')), 'hex')
    OR p_payload->>'eventType' IS DISTINCT FROM 'interest-accrued.success'
    OR p_payload->>'eventCategory' IS DISTINCT FROM 'interest_accrued' THEN RETURN 'invalid'; END IF;
  FOREACH field IN ARRAY ARRAY['eventId', 'pvb_wallet', 'customer_id'] LOOP
    IF json_typeof(p_payload->field) IS DISTINCT FROM 'string'
      OR octet_length(p_payload->>field) NOT BETWEEN 1 AND 512 THEN RETURN 'invalid'; END IF;
  END LOOP;
  provider_event_id := p_payload->>'eventId';
  IF provider_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN 'invalid'; END IF;
  public_wallet := p_payload->>'pvb_wallet';
  provider_customer := p_payload->>'customer_id';
  detail := p_payload->'eventData';
  IF json_typeof(detail) IS DISTINCT FROM 'object' THEN RETURN 'invalid'; END IF;
  FOREACH field IN ARRAY ARRAY['id', 'wallet_id', 'interest_date', 'interest_type'] LOOP
    IF json_typeof(detail->field) IS DISTINCT FROM 'string'
      OR octet_length(detail->>field) NOT BETWEEN 1 AND 512 THEN RETURN 'invalid'; END IF;
  END LOOP;
  IF detail->>'interest_type' NOT IN ('original', 'differential')
    OR detail->>'interest_date' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
    OR json_typeof(p_payload->'pvb_split_interest_with_wallet') IS NULL
    OR json_typeof(p_payload->'pvb_split_interest_with_wallet') NOT IN ('string', 'null')
    OR json_typeof(p_payload->'pvb_split_interest_with_wallet_name') IS NULL
    OR json_typeof(p_payload->'pvb_split_interest_with_wallet_name') NOT IN ('string', 'null') THEN RETURN 'invalid'; END IF;
  split_destination := p_payload->>'pvb_split_interest_with_wallet';
  IF (split_destination IS NOT NULL AND split_destination !~* '^[0-9A-HJKMNP-TV-Z]{26}$')
    OR (split_destination IS NULL) IS DISTINCT FROM (p_payload->>'pvb_split_interest_with_wallet_name' IS NULL)
    OR length(p_payload->>'pvb_split_interest_with_wallet_name') > 512 THEN RETURN 'invalid'; END IF;
  FOREACH field IN ARRAY ARRAY['amount', 'balance', 'percentage'] LOOP
    IF json_typeof(detail->field) IS DISTINCT FROM 'number' THEN RETURN 'invalid'; END IF;
  END LOOP;
  BEGIN
    amount_text := detail->>'amount';
    amount := amount_text::numeric;
    accrual_date := (detail->>'interest_date')::timestamptz;
    IF amount NOT BETWEEN 0 AND 9007199254740991
      OR (detail->>'balance')::numeric NOT BETWEEN 0 AND 9007199254740991
      OR (detail->>'percentage')::numeric NOT BETWEEN 0 AND 100 THEN RETURN 'invalid'; END IF;
    economics := jsonb_build_object('businessId', p_business, 'providerCustomerId', provider_customer,
      'internalWalletId', detail->>'wallet_id', 'interestDate', extract(epoch FROM accrual_date),
      'interestType', detail->>'interest_type', 'splitDestinationWalletId', split_destination,
      'amountKobo', amount, 'balanceKobo', (detail->>'balance')::numeric,
      'percentage', (detail->>'percentage')::numeric);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RETURN 'invalid';
  END;
  accrual_id := detail->>'id';
  PERFORM pg_advisory_xact_lock(hashtextextended('piggyvest-interest-accrual:' || p_integration::text, 0));
  SELECT binding.integration_id, binding.provider_wallet_id, binding.provider_customer_id,
    binding.merchant_id, binding.customer_id, binding.goal_id INTO mapping
    FROM piggyvest_staging.wallet_goal_mappings binding
    JOIN piggyvest_staging.integrations registry ON registry.id = binding.integration_id
      AND registry.enabled AND registry.expected_provider_account_id = p_business COLLATE "C"
    JOIN public.customers customer ON customer.id = binding.customer_id AND customer.merchant_id = binding.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id = binding.goal_id
      AND goal.merchant_id = binding.merchant_id AND goal.customer_id = binding.customer_id
    WHERE binding.integration_id = p_integration AND binding.provider_wallet_id = public_wallet
      AND binding.provider_customer_id = provider_customer FOR SHARE OF binding, registry, customer, goal;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_staging.interest_accrual_receipts receipt
    WHERE receipt.integration_id = p_integration AND receipt.receipt_id = p_receipt_id
      AND (receipt.event_id <> provider_event_id OR receipt.payload_sha256 <> p_payload_sha256)) THEN RETURN 'conflict'; END IF;
  SELECT observation.id, observation.provider_wallet_id, observation.provider_accrual_id, observation.economics
    INTO stored FROM piggyvest_staging.interest_accrual_observations observation
    JOIN piggyvest_staging.interest_accrual_receipts receipt ON receipt.observation_id = observation.id
    WHERE receipt.integration_id = p_integration AND receipt.event_id = provider_event_id;
  IF FOUND THEN
    IF stored.provider_wallet_id <> public_wallet OR stored.provider_accrual_id <> accrual_id
      OR stored.economics IS DISTINCT FROM economics THEN RETURN 'conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  SELECT observation.id, observation.provider_wallet_id, observation.provider_accrual_id, observation.economics
    INTO stored FROM piggyvest_staging.interest_accrual_observations observation
    WHERE observation.integration_id = p_integration AND observation.provider_wallet_id = public_wallet
      AND observation.provider_accrual_id = accrual_id;
  duplicate_observation := FOUND;
  IF duplicate_observation THEN
    IF stored.economics IS DISTINCT FROM economics THEN RETURN 'conflict'; END IF;
    observation_id := stored.id;
  ELSE
    INSERT INTO piggyvest_staging.interest_accrual_observations(integration_id, provider_business_id,
      provider_wallet_id, provider_customer_id, provider_accrual_id, internal_wallet_id,
      merchant_id, customer_id, goal_id, interest_date, interest_type, split_destination_wallet_id,
      amount_lexeme, amount_kobo, economics)
    VALUES (p_integration, p_business, public_wallet, provider_customer, accrual_id, detail->>'wallet_id',
      mapping.merchant_id, mapping.customer_id, mapping.goal_id, accrual_date, detail->>'interest_type',
      split_destination, amount_text, amount, economics) RETURNING id INTO observation_id;
  END IF;
  INSERT INTO piggyvest_staging.interest_accrual_receipts(integration_id, event_id, observation_id, receipt_id, payload_sha256)
    VALUES (p_integration, provider_event_id, observation_id, p_receipt_id, p_payload_sha256);
  RETURN CASE WHEN duplicate_observation THEN 'duplicate' ELSE 'applied' END;
END $$;
REVOKE ALL ON FUNCTION piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)
  FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_ledger_worker') THEN
    GRANT USAGE ON SCHEMA piggyvest_staging TO piggyvest_staging_ledger_worker;
    GRANT EXECUTE ON FUNCTION piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)
      TO piggyvest_staging_ledger_worker;
  END IF;
END $$;
COMMENT ON FUNCTION piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json) IS
  'Private fractional-kobo observation only. Restricted replay caller must verify original provider signature and pass exact verified UTF8 JSON bytes as json, not reserialized JavaScript numbers. SQL independently binds SHA256 to that text and rechecks physical database pin and ownership. First transport evidence per event is immutable; duplicate economics ignore descriptive names. No ledger credit or exact unpaid-balance claim. Migration never creates the ledger worker; absent-role grants are skipped. Later role creation does not activate this function: separately reviewed owner provisioning must explicitly grant schema USAGE and only this function EXECUTE, never table privileges.';
COMMIT;
