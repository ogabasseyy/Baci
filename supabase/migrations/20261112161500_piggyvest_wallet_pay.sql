-- PiggyVest "pay from your wallet" (dark). A customer pays Ogabassey for a
-- purchase (an IMEI check, or airtime/data/bills) with a wallet-to-wallet
-- transfer from their PiggyVest main wallet into Ogabassey's collection wallet
-- at PiggyVest. If Ogabassey cannot deliver, the same amount goes back from the
-- collection wallet to the customer's main wallet, exactly once. Design:
-- docs/superpowers/plans/2026-11-12-piggyvest-pay-from-wallet.md.
--
-- Nothing here touches public.customer_wallets: PiggyVest is the system of
-- record for the main wallet, and that table is the legacy store-credit ledger.
--
-- ONE migration on purpose (a half-applied money schema is worse than a long
-- file). Sections:
--   1. PIN proof purpose 'wallet_pay'
--   2. tables: collection_wallets, wallet_payments, wallet_payment_refunds
--   3. authority helpers
--   4. customer side (authorizer login + customer scope): issue, issued check,
--      reserve-with-PIN, manage, status
--   5. worker side (authorizer login + integration authority): fulfilment
--      claim/finish, refund drive, work list
--   6. evidence side (evidence login): read dispatched, find by reference,
--      settle / release for payments and refunds, reconciliation read
--   7. deletion fence
--   8. grants
--
-- Rules carried over from goal cancel (20261103085004) and complete:
--  * The operation id is issued by the server before any PIN is typed, with
--    the amount the server priced. The PIN proof binds that exact amount and
--    sha256('pay:<purpose>:<purchaseRef>:<operationId>'), and is spent in the
--    SAME transaction as the reservation.
--  * Provider references are never reused. A payment's reference is
--    'pvb-pay-<paymentId>' (one per attempt). A refund's is
--    'pvb-refund-<paymentId>', then '-<n>' after a dispatched attempt is
--    released. Both are UNIQUE.
--  * Pending is never paid: fulfilment can be claimed only for a payment a
--    verified provider record confirmed.
--  * A refund is created only here, from a confirmed payment, for exactly the
--    confirmed amount. Nothing a caller passes sizes or targets it.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. -------------------------------------------------------------------------
INSERT INTO wallet_pin_private.proof_purposes (purpose)
VALUES ('wallet_pay')
ON CONFLICT (purpose) DO NOTHING;

-- 2. -------------------------------------------------------------------------
-- Ogabassey's collection wallet per integration. Owner SQL only (operator
-- runbook); the application also requires PIGGYVEST_COLLECTION_WALLET_ID to
-- equal this row before it sends anything.
CREATE TABLE piggyvest_primary.collection_wallets (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary.integrations(id),
  provider_wallet_id text NOT NULL UNIQUE
    CHECK (pg_catalog.octet_length(provider_wallet_id) BETWEEN 1 AND 200),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE piggyvest_primary.collection_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_wallets_deny ON piggyvest_primary.collection_wallets
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.collection_wallets
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

CREATE TABLE piggyvest_primary.wallet_payments (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  intent_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('imei_check', 'vtu')),
  purchase_ref text NOT NULL CHECK (purchase_ref ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  state text NOT NULL CHECK (state IN (
    'issued', 'reserved', 'dispatched', 'confirmed', 'released', 'needs_review')),
  reference text UNIQUE CHECK (reference IS NULL OR reference = 'pvb-pay-' || id::text),
  source_wallet_id text,
  destination_wallet_id text,
  provider_transaction_id text,
  fulfilment text NOT NULL DEFAULT 'awaiting' CHECK (fulfilment IN (
    'awaiting', 'claimed', 'fulfilled', 'refund_owed', 'refunded')),
  review_reason text CHECK (review_reason IS NULL OR pg_catalog.char_length(review_reason) <= 64),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  dispatched_at timestamptz,
  settled_at timestamptz,
  fulfilment_claimed_at timestamptz,
  -- A fresh token per claim: only the current claimant may finish delivery,
  -- so a worker that outlived its lease can not overwrite a reclaim.
  fulfilment_claim_token uuid,
  fulfilment_finished_at timestamptz,
  CHECK (state IN ('issued', 'released') OR (
    reference IS NOT NULL AND source_wallet_id IS NOT NULL
    AND destination_wallet_id IS NOT NULL AND source_wallet_id <> destination_wallet_id)),
  CHECK (reference IS NOT NULL OR reserved_at IS NULL),
  CHECK (state NOT IN ('confirmed', 'needs_review') OR provider_transaction_id IS NOT NULL),
  -- Only a confirmed payment is ever delivered or refunded.
  CHECK (fulfilment = 'awaiting' OR state = 'confirmed')
);
-- A purchase is paid at most once: one live payment per purchase. A confirmed
-- payment that is being (or was) refunded no longer covers the purchase, so a
-- late duplicate success can be confirmed straight into refund_owed.
CREATE UNIQUE INDEX wallet_payments_one_live_per_purchase_idx
  ON piggyvest_primary.wallet_payments (integration_id, purpose, purchase_ref)
  WHERE state IN ('reserved', 'dispatched', 'needs_review')
     OR (state = 'confirmed' AND fulfilment IN ('awaiting', 'claimed', 'fulfilled'));
CREATE UNIQUE INDEX wallet_payments_provider_transaction_idx
  ON piggyvest_primary.wallet_payments (integration_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX wallet_payments_intent_idx ON piggyvest_primary.wallet_payments (intent_id);
CREATE INDEX wallet_payments_work_idx ON piggyvest_primary.wallet_payments (integration_id, state, fulfilment);
ALTER TABLE piggyvest_primary.wallet_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_payments_deny ON piggyvest_primary.wallet_payments
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.wallet_payments
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

CREATE TABLE piggyvest_primary.wallet_payment_refunds (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES piggyvest_primary.wallet_payments(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  attempt integer NOT NULL CHECK (attempt BETWEEN 0 AND 20),
  state text NOT NULL CHECK (state IN ('owed', 'dispatched', 'confirmed', 'released', 'needs_review')),
  reference text NOT NULL UNIQUE,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  source_wallet_id text NOT NULL,
  destination_wallet_id text NOT NULL,
  provider_transaction_id text,
  review_reason text CHECK (review_reason IS NULL OR pg_catalog.char_length(review_reason) <= 64),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  dispatched_at timestamptz,
  settled_at timestamptz,
  CONSTRAINT wallet_payment_refunds_attempt_key UNIQUE (payment_id, attempt),
  CHECK (reference = 'pvb-refund-' || payment_id::text
         || CASE WHEN attempt = 0 THEN '' ELSE '-' || attempt::text END),
  CHECK (source_wallet_id <> destination_wallet_id),
  CHECK (state NOT IN ('confirmed', 'needs_review') OR provider_transaction_id IS NOT NULL
         OR review_reason IS NOT NULL)
);
-- One live refund per payment; a released attempt is followed by a new one.
CREATE UNIQUE INDEX wallet_payment_refunds_one_live_idx
  ON piggyvest_primary.wallet_payment_refunds (payment_id)
  WHERE state IN ('owed', 'dispatched', 'confirmed', 'needs_review');
CREATE UNIQUE INDEX wallet_payment_refunds_provider_transaction_idx
  ON piggyvest_primary.wallet_payment_refunds (integration_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX wallet_payment_refunds_work_idx
  ON piggyvest_primary.wallet_payment_refunds (integration_id, state);
ALTER TABLE piggyvest_primary.wallet_payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_payment_refunds_deny ON piggyvest_primary.wallet_payment_refunds
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.wallet_payment_refunds
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- 3. -------------------------------------------------------------------------
-- Integration authority for the server-side worker (authorizer login, no
-- customer in the request: fulfilment and refunds).
CREATE FUNCTION piggyvest_primary.assert_wallet_pay_worker(p_integration_id uuid, p_environment text)
RETURNS piggyvest_primary.integrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  SELECT binding.* INTO v_binding FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.savings_authorities AS authority ON authority.integration_id = binding.id
   WHERE binding.id = p_integration_id AND binding.environment = p_environment
     AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet pay authority unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_binding;
END;
$$;

-- Evidence authority (provider conclusions only).
CREATE FUNCTION piggyvest_primary.assert_wallet_pay_evidence(p_integration_id uuid, p_environment text)
RETURNS piggyvest_primary.integrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  SELECT binding.* INTO v_binding FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
   WHERE binding.id = p_integration_id AND binding.environment = p_environment
     AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_binding;
END;
$$;

-- Whether a payment covers its purchase (the predicate of the live index).
CREATE FUNCTION piggyvest_primary.wallet_payment_is_live(p_state text, p_fulfilment text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_state IN ('reserved', 'dispatched', 'needs_review')
    OR (p_state = 'confirmed' AND p_fulfilment IN ('awaiting', 'claimed', 'fulfilled'));
$$;

-- Rotating order for bounded work lists: a different slice each minute, so
-- items that stay inconclusive can never starve newer work.
CREATE FUNCTION piggyvest_primary.wallet_pay_rotation(p_id uuid)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT pg_catalog.md5(p_id::text || pg_catalog.to_char(pg_catalog.clock_timestamp(), 'YYYYMMDDHH24MI'));
$$;

-- The PIN binding text, in one place (lower-case UUID on both sides).
CREATE FUNCTION piggyvest_primary.wallet_pay_pin_key(p_payment piggyvest_primary.wallet_payments)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'pay:' || p_payment.purpose || ':' || p_payment.purchase_ref || ':' || p_payment.id::text,
    'UTF8')), 'hex');
$$;

-- Shared shape check for a settlement / release proof: the seven savings keys,
-- plus an optional feeKobo the provider record reported (>= 0).
CREATE FUNCTION piggyvest_primary.wallet_pay_proof_valid(proof jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(CASE
    WHEN proof IS NOT NULL AND pg_catalog.jsonb_typeof(proof) = 'object' THEN
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(proof)) BETWEEN 7 AND 8
      AND (proof ?& ARRAY['operationId', 'providerTransactionId', 'reference', 'amountKobo',
                          'sourceWalletId', 'destinationWalletId', 'businessId']) IS TRUE
      AND pg_catalog.jsonb_typeof(proof -> 'amountKobo') = 'number'
      AND COALESCE(proof ->> 'amountKobo', '') ~ '^[1-9][0-9]{0,9}$'
      AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(proof)) = 7
           OR (proof ? 'feeKobo'
               AND pg_catalog.jsonb_typeof(proof -> 'feeKobo') = 'number'
               AND COALESCE(proof ->> 'feeKobo', '') ~ '^(0|[1-9][0-9]{0,9})$'))
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_each(proof) AS field
         WHERE field.key NOT IN ('amountKobo', 'feeKobo')
           AND (pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'string'
                OR pg_catalog.octet_length(field.value #>> '{}') NOT BETWEEN 1 AND 512))
    ELSE false END, false);
$$;

-- Opens the first refund attempt of a confirmed payment (inside the caller's
-- transaction, with the payment row already locked). Idempotent.
CREATE FUNCTION piggyvest_primary.open_wallet_payment_refund(p_payment piggyvest_primary.wallet_payments)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_payment.state <> 'confirmed' THEN
    RAISE EXCEPTION 'only a confirmed payment is refunded' USING ERRCODE = '22023';
  END IF;
  INSERT INTO piggyvest_primary.wallet_payment_refunds
    (payment_id, integration_id, attempt, state, reference, amount_kobo,
     source_wallet_id, destination_wallet_id)
  SELECT p_payment.id, p_payment.integration_id, 0, 'owed', 'pvb-refund-' || p_payment.id::text,
    p_payment.amount_kobo, p_payment.destination_wallet_id, p_payment.source_wallet_id
   WHERE NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS existing
                      WHERE existing.payment_id = p_payment.id);
END;
$$;

-- 4. -------------------------------------------------------------------------
-- Issues (or returns) the server operation id for one payment of one purchase.
-- The amount is the server's price for the purchase (this login is server-only;
-- no client value reaches here unchecked). A live payment for the same purchase
-- answers with its state instead of a new id.
CREATE FUNCTION piggyvest_primary.issue_wallet_payment(scope jsonb, request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_purpose text;
  v_ref text;
  v_amount bigint;
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF request IS NULL OR pg_catalog.jsonb_typeof(request) <> 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(request)) <> 3
    OR (request ?& ARRAY['purpose', 'purchaseRef', 'amountKobo']) IS NOT TRUE
    OR pg_catalog.jsonb_typeof(request -> 'purpose') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request -> 'purchaseRef') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(request -> 'amountKobo') IS DISTINCT FROM 'number'
    OR COALESCE(request ->> 'amountKobo', '') !~ '^[1-9][0-9]{0,9}$'
    OR request ->> 'purpose' NOT IN ('imei_check', 'vtu')
    OR COALESCE(request ->> 'purchaseRef', '') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid wallet payment request' USING ERRCODE = '22023';
  END IF;
  v_purpose := request ->> 'purpose';
  v_ref := request ->> 'purchaseRef';
  v_amount := (request ->> 'amountKobo')::bigint;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'wallet-pay:' || (scope ->> 'integrationId') || ':' || v_purpose || ':' || v_ref, 0));
  SELECT live.* INTO v_payment FROM piggyvest_primary.wallet_payments AS live
   WHERE live.integration_id = (scope ->> 'integrationId')::uuid
     AND live.purpose = v_purpose AND live.purchase_ref = v_ref
     AND piggyvest_primary.wallet_payment_is_live(live.state, live.fulfilment)
     FOR UPDATE;
  IF FOUND THEN
    IF v_payment.intent_id <> v_intent_id THEN
      RETURN pg_catalog.jsonb_build_object('status', 'conflict');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status', CASE v_payment.state WHEN 'confirmed' THEN 'confirmed'
                  WHEN 'needs_review' THEN 'needs_review' ELSE 'pending' END,
      'operationId', v_payment.id, 'amountKobo', v_payment.amount_kobo);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.collection_wallets AS collection
                  WHERE collection.integration_id = (scope ->> 'integrationId')::uuid
                    AND collection.enabled) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  -- Expired or re-priced issued ids for this purchase are dead.
  v_now := pg_catalog.clock_timestamp();
  UPDATE piggyvest_primary.wallet_payments AS stale SET state = 'released'
   WHERE stale.integration_id = (scope ->> 'integrationId')::uuid
     AND stale.purpose = v_purpose AND stale.purchase_ref = v_ref AND stale.state = 'issued'
     AND (stale.expires_at <= v_now OR stale.amount_kobo <> v_amount OR stale.intent_id <> v_intent_id);
  SELECT fresh.* INTO v_payment FROM piggyvest_primary.wallet_payments AS fresh
   WHERE fresh.integration_id = (scope ->> 'integrationId')::uuid AND fresh.intent_id = v_intent_id
     AND fresh.purpose = v_purpose AND fresh.purchase_ref = v_ref AND fresh.state = 'issued'
   ORDER BY fresh.issued_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO piggyvest_primary.wallet_payments
      (id, integration_id, intent_id, purpose, purchase_ref, amount_kobo, state, issued_at, expires_at)
    VALUES (pg_catalog.gen_random_uuid(), (scope ->> 'integrationId')::uuid, v_intent_id,
      v_purpose, v_ref, v_amount, 'issued', v_now, v_now + interval '10 minutes')
    RETURNING * INTO v_payment;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'issued', 'operationId', v_payment.id, 'amountKobo', v_payment.amount_kobo,
    'expiresAt', v_payment.expires_at);
END;
$$;

-- The PIN verify route reads the binding of a live issued id from here, so the
-- client never supplies the amount, purpose or purchase. NULL otherwise.
CREATE FUNCTION piggyvest_primary.read_issued_wallet_payment(scope jsonb, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_result jsonb;
BEGIN
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  SELECT pg_catalog.jsonb_build_object(
      'operationId', payment.id, 'purpose', payment.purpose,
      'purchaseRef', payment.purchase_ref, 'amountKobo', payment.amount_kobo,
      'pinKeySha256', piggyvest_primary.wallet_pay_pin_key(payment))
    INTO v_result
    FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = read_issued_wallet_payment.operation_id
     AND payment.intent_id = v_intent_id
     AND payment.integration_id = (scope ->> 'integrationId')::uuid
     AND payment.state = 'issued' AND payment.expires_at > pg_catalog.clock_timestamp();
  RETURN v_result;
END;
$$;

-- Reserves the payment and spends the wallet_pay PIN proof in one transaction.
-- Unlike goal funding there is no "PIN checking off" path: this is a new
-- outflow kind, so a proof is always required.
CREATE FUNCTION piggyvest_primary.reserve_wallet_payment_with_pin(scope jsonb, request jsonb, pin_proof text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_collection piggyvest_primary.collection_wallets%ROWTYPE;
  v_outcome text;
BEGIN
  IF request IS NULL OR pg_catalog.jsonb_typeof(request) <> 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(request)) <> 1
    OR pg_catalog.jsonb_typeof(request -> 'operationId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid wallet payment request' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = (request ->> 'operationId')::uuid
     AND payment.integration_id = (scope ->> 'integrationId')::uuid
     AND payment.intent_id = v_intent_id
     FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'conflict'); END IF;
  IF v_payment.state = 'confirmed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'confirmed');
  ELSIF v_payment.state = 'needs_review' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  ELSIF v_payment.state IN ('reserved', 'dispatched') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending');
  ELSIF v_payment.state = 'released' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'released');
  END IF;
  IF v_payment.expires_at <= pg_catalog.clock_timestamp() THEN
    UPDATE piggyvest_primary.wallet_payments SET state = 'released' WHERE id = v_payment.id;
    RETURN pg_catalog.jsonb_build_object('status', 'expired');
  END IF;
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_intent_id;
  SELECT collection.* INTO v_collection FROM piggyvest_primary.collection_wallets AS collection
   WHERE collection.integration_id = v_payment.integration_id AND collection.enabled
     FOR SHARE;
  -- The collection wallet must never be a customer's own wallet.
  IF NOT FOUND OR v_intent.provider_wallet_id IS NULL OR v_intent.provider_customer_id IS NULL
    OR v_intent.provider_wallet_id = v_collection.provider_wallet_id
    OR EXISTS (SELECT 1 FROM piggyvest_primary.onboarding_intents AS other
                WHERE other.provider_wallet_id = v_collection.provider_wallet_id)
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_destinations AS goal_wallet
                WHERE goal_wallet.provider_wallet_id = v_collection.provider_wallet_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  -- Another payment for the same purchase may have gone live since issue.
  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payments AS live
              WHERE live.integration_id = v_payment.integration_id
                AND live.purpose = v_payment.purpose AND live.purchase_ref = v_payment.purchase_ref
                AND live.id <> v_payment.id
                AND piggyvest_primary.wallet_payment_is_live(live.state, live.fulfilment)) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;
  BEGIN
    v_outcome := wallet_pin_private.consume_wallet_pin_proof(
      (scope ->> 'customerId')::uuid, (scope ->> 'merchantId')::uuid, 'wallet_pay',
      v_payment.amount_kobo, piggyvest_primary.wallet_pay_pin_key(v_payment), pin_proof);
    IF v_outcome IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION 'pin_refused:%', COALESCE(v_outcome, 'invalid') USING ERRCODE = 'PVP01';
    END IF;
    UPDATE piggyvest_primary.wallet_payments
       SET state = 'reserved', reserved_at = pg_catalog.clock_timestamp(),
           reference = 'pvb-pay-' || v_payment.id::text,
           source_wallet_id = v_intent.provider_wallet_id,
           destination_wallet_id = v_collection.provider_wallet_id
     WHERE id = v_payment.id
     RETURNING * INTO v_payment;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'claimed',
      'reservation', pg_catalog.jsonb_build_object(
        'operationId', v_payment.id, 'purpose', v_payment.purpose,
        'purchaseRef', v_payment.purchase_ref, 'amountKobo', v_payment.amount_kobo,
        'sourceWalletId', v_payment.source_wallet_id,
        'destinationWalletId', v_payment.destination_wallet_id,
        'reference', v_payment.reference, 'businessId', scope ->> 'businessId',
        'providerCustomerId', v_intent.provider_customer_id));
  EXCEPTION WHEN SQLSTATE 'PVP01' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'pin_refused', 'reason', pg_catalog.replace(SQLERRM, 'pin_refused:', ''));
  END;
END;
$$;

-- dispatch: reserved -> dispatched. cancel / cancel_stale: reserved -> released
-- (nothing was sent). release: dispatched -> released (definitive rejection
-- and no transfer found under the reference).
CREATE FUNCTION piggyvest_primary.manage_wallet_payment(scope jsonb, operation_id uuid, action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
BEGIN
  IF operation_id IS NULL OR action IS NULL
    OR action NOT IN ('dispatch', 'cancel', 'cancel_stale', 'release') THEN
    RAISE EXCEPTION 'invalid wallet payment transition' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = manage_wallet_payment.operation_id AND payment.intent_id = v_intent_id
     AND payment.integration_id = (scope ->> 'integrationId')::uuid
     FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF action = 'release' THEN
    IF v_payment.state <> 'dispatched' THEN RETURN false; END IF;
    UPDATE piggyvest_primary.wallet_payments SET state = 'released' WHERE id = v_payment.id;
    RETURN true;
  END IF;
  IF v_payment.state <> 'reserved' THEN RETURN false; END IF;
  IF action = 'cancel_stale'
    AND v_payment.reserved_at >= pg_catalog.clock_timestamp() - interval '5 minutes' THEN
    RETURN false;
  END IF;
  IF action <> 'dispatch' THEN
    UPDATE piggyvest_primary.wallet_payments SET state = 'released' WHERE id = v_payment.id;
    RETURN true;
  END IF;
  -- Dispatch re-checks the wallets at the transition.
  PERFORM 1 FROM piggyvest_primary.onboarding_intents AS intent
    JOIN piggyvest_primary.collection_wallets AS collection
      ON collection.integration_id = v_payment.integration_id AND collection.enabled
   WHERE intent.id = v_intent_id
     AND intent.provider_wallet_id = v_payment.source_wallet_id
     AND collection.provider_wallet_id = v_payment.destination_wallet_id
     FOR SHARE OF intent, collection;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE piggyvest_primary.wallet_payments
     SET state = 'dispatched', dispatched_at = pg_catalog.clock_timestamp()
   WHERE id = v_payment.id;
  RETURN true;
END;
$$;

CREATE FUNCTION piggyvest_primary.read_wallet_payment_status(scope jsonb, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_result jsonb;
BEGIN
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  SELECT pg_catalog.jsonb_build_object(
      'state', payment.state, 'fulfilment', payment.fulfilment,
      'purpose', payment.purpose, 'purchaseRef', payment.purchase_ref,
      'amountKobo', payment.amount_kobo,
      'refund', (SELECT refund.state FROM piggyvest_primary.wallet_payment_refunds AS refund
                  WHERE refund.payment_id = payment.id ORDER BY refund.attempt DESC LIMIT 1))
    INTO v_result
    FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = read_wallet_payment_status.operation_id AND payment.intent_id = v_intent_id
     AND payment.integration_id = (scope ->> 'integrationId')::uuid;
  RETURN v_result;
END;
$$;

-- The newest payment of this customer for one purchase that is not a dead
-- attempt (issued-and-expired or released), or NULL. Lets a product tell its
-- own wallet-paid purchases from ones started another way.
CREATE FUNCTION piggyvest_primary.read_wallet_payment_for_purchase(scope jsonb, request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_result jsonb;
BEGIN
  IF request IS NULL OR pg_catalog.jsonb_typeof(request) <> 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(request)) <> 2
    OR request ->> 'purpose' NOT IN ('imei_check', 'vtu')
    OR COALESCE(request ->> 'purchaseRef', '') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid wallet payment request' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  SELECT pg_catalog.jsonb_build_object('operationId', payment.id, 'state', payment.state)
    INTO v_result
    FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.integration_id = (scope ->> 'integrationId')::uuid
     AND payment.intent_id = v_intent_id
     AND payment.purpose = request ->> 'purpose'
     AND payment.purchase_ref = request ->> 'purchaseRef'
     AND (payment.state NOT IN ('issued', 'released')
          OR (payment.state = 'issued' AND payment.expires_at > pg_catalog.clock_timestamp()))
     -- A confirmed payment whose delivery failed and is (being) refunded no
     -- longer covers the purchase (the same rule as the live-payment index).
     AND NOT (payment.state = 'confirmed' AND payment.fulfilment IN ('refund_owed', 'refunded'))
   ORDER BY payment.issued_at DESC
   LIMIT 1;
  RETURN v_result;
END;
$$;

-- 5. -------------------------------------------------------------------------
-- Claims delivery of a CONFIRMED payment. Only the winner delivers. A claim
-- older than 10 minutes can be taken again ('reclaimed'): the product must
-- then use its own idempotent recovery (lookup id / VTU requery), never a
-- blind second delivery.
CREATE FUNCTION piggyvest_primary.claim_wallet_payment_fulfilment(
  integration_id uuid, environment text, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
  v_now timestamptz;
  v_reclaim boolean;
BEGIN
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    claim_wallet_payment_fulfilment.integration_id, claim_wallet_payment_fulfilment.environment);
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = claim_wallet_payment_fulfilment.operation_id
     AND payment.integration_id = claim_wallet_payment_fulfilment.integration_id
     FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  IF v_payment.state <> 'confirmed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_confirmed');
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_payment.fulfilment = 'claimed' AND v_payment.fulfilment_claimed_at > v_now - interval '10 minutes' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  IF v_payment.fulfilment NOT IN ('awaiting', 'claimed') THEN
    RETURN pg_catalog.jsonb_build_object('status', v_payment.fulfilment);
  END IF;
  v_reclaim := v_payment.fulfilment = 'claimed';
  UPDATE piggyvest_primary.wallet_payments
     SET fulfilment = 'claimed', fulfilment_claimed_at = v_now,
         fulfilment_claim_token = pg_catalog.gen_random_uuid()
   WHERE id = v_payment.id
   RETURNING * INTO v_payment;
  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN v_reclaim THEN 'reclaimed' ELSE 'claimed' END,
    'purpose', v_payment.purpose, 'purchaseRef', v_payment.purchase_ref,
    'amountKobo', v_payment.amount_kobo, 'claimToken', v_payment.fulfilment_claim_token);
END;
$$;

-- Records the delivery outcome of a claimed payment. 'failed' owes a refund:
-- the first refund attempt is opened in the same transaction. Replays answer
-- 'duplicate'; anything else is a conflict and changes nothing.
CREATE FUNCTION piggyvest_primary.finish_wallet_payment_fulfilment(
  integration_id uuid, environment text, operation_id uuid, outcome text, claim_token uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
  v_target text;
BEGIN
  IF outcome IS NULL OR outcome NOT IN ('fulfilled', 'failed') THEN
    RAISE EXCEPTION 'invalid fulfilment outcome' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    finish_wallet_payment_fulfilment.integration_id, finish_wallet_payment_fulfilment.environment);
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = finish_wallet_payment_fulfilment.operation_id
     AND payment.integration_id = finish_wallet_payment_fulfilment.integration_id
     FOR UPDATE;
  IF NOT FOUND OR v_payment.state <> 'confirmed' THEN RETURN 'conflict'; END IF;
  v_target := CASE outcome WHEN 'fulfilled' THEN 'fulfilled' ELSE 'refund_owed' END;
  IF v_payment.fulfilment = v_target
    OR (outcome = 'failed' AND v_payment.fulfilment = 'refunded') THEN
    RETURN 'duplicate';
  END IF;
  IF v_payment.fulfilment <> 'claimed'
    OR v_payment.fulfilment_claim_token IS DISTINCT FROM finish_wallet_payment_fulfilment.claim_token THEN
    RETURN 'conflict';
  END IF;
  UPDATE piggyvest_primary.wallet_payments
     SET fulfilment = v_target, fulfilment_finished_at = pg_catalog.clock_timestamp()
   WHERE id = v_payment.id
   RETURNING * INTO v_payment;
  IF v_target = 'refund_owed' THEN
    PERFORM piggyvest_primary.open_wallet_payment_refund(v_payment);
  END IF;
  RETURN v_target;
END;
$$;

-- A reservation older than 5 minutes was never sent (a live submission moves
-- it to dispatched within seconds): the drain releases it. Nothing moved.
CREATE FUNCTION piggyvest_primary.release_stale_wallet_payment(
  integration_id uuid, environment text, operation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    release_stale_wallet_payment.integration_id, release_stale_wallet_payment.environment);
  UPDATE piggyvest_primary.wallet_payments AS payment SET state = 'released'
   WHERE payment.id = release_stale_wallet_payment.operation_id
     AND payment.integration_id = release_stale_wallet_payment.integration_id
     AND payment.state = 'reserved'
     AND payment.reserved_at <= pg_catalog.clock_timestamp() - interval '5 minutes';
  RETURN FOUND;
END;
$$;

-- The live owed refund of a payment as a reservation for the one-shot POST.
CREATE FUNCTION piggyvest_primary.read_owed_wallet_refund(
  integration_id uuid, environment text, payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_worker(
    read_owed_wallet_refund.integration_id, read_owed_wallet_refund.environment);
  SELECT pg_catalog.jsonb_build_object(
      'refundId', refund.id, 'operationId', refund.payment_id, 'amountKobo', refund.amount_kobo,
      'sourceWalletId', refund.source_wallet_id, 'destinationWalletId', refund.destination_wallet_id,
      'reference', refund.reference, 'businessId', v_binding.business_id,
      'providerCustomerId', intent.provider_customer_id)
    INTO v_result
    FROM piggyvest_primary.wallet_payment_refunds AS refund
    JOIN piggyvest_primary.wallet_payments AS payment ON payment.id = refund.payment_id
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = payment.intent_id
   WHERE refund.payment_id = read_owed_wallet_refund.payment_id
     AND refund.integration_id = v_binding.id AND refund.state = 'owed'
     AND intent.provider_wallet_id = refund.destination_wallet_id;
  RETURN v_result;
END;
$$;

-- dispatch: owed -> dispatched (the caller POSTs once afterwards).
-- release: dispatched -> released after a definitive rejection with no
-- transfer found; the next attempt (fresh reference) is opened at once.
CREATE FUNCTION piggyvest_primary.manage_wallet_refund(
  integration_id uuid, environment text, refund_id uuid, action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund piggyvest_primary.wallet_payment_refunds%ROWTYPE;
BEGIN
  IF action IS NULL OR action NOT IN ('dispatch', 'release') THEN
    RAISE EXCEPTION 'invalid wallet refund transition' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    manage_wallet_refund.integration_id, manage_wallet_refund.environment);
  SELECT refund.* INTO v_refund FROM piggyvest_primary.wallet_payment_refunds AS refund
   WHERE refund.id = manage_wallet_refund.refund_id
     AND refund.integration_id = manage_wallet_refund.integration_id
     FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF action = 'dispatch' THEN
    IF v_refund.state <> 'owed' THEN RETURN false; END IF;
    UPDATE piggyvest_primary.wallet_payment_refunds
       SET state = 'dispatched', dispatched_at = pg_catalog.clock_timestamp()
     WHERE id = v_refund.id;
    RETURN true;
  END IF;
  IF v_refund.state <> 'dispatched' THEN RETURN false; END IF;
  PERFORM piggyvest_primary.next_wallet_refund_attempt(v_refund);
  RETURN true;
END;
$$;

-- Releases a dispatched refund attempt and opens the next one (inside the
-- caller's transaction, refund row locked). After attempt 20 the refund waits
-- for a person instead of minting more references.
CREATE FUNCTION piggyvest_primary.next_wallet_refund_attempt(p_refund piggyvest_primary.wallet_payment_refunds)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE piggyvest_primary.wallet_payment_refunds SET state = 'released' WHERE id = p_refund.id;
  -- A late refund success (or any other review reason) freezes retries: a
  -- person decides whether anything is still owed.
  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payments AS payment
              WHERE payment.id = p_refund.payment_id AND payment.review_reason IS NOT NULL) THEN
    RETURN;
  END IF;
  IF p_refund.attempt >= 20 THEN
    UPDATE piggyvest_primary.wallet_payments SET review_reason = 'refund_attempts_exhausted'
     WHERE id = p_refund.payment_id;
    RETURN;
  END IF;
  INSERT INTO piggyvest_primary.wallet_payment_refunds
    (payment_id, integration_id, attempt, state, reference, amount_kobo,
     source_wallet_id, destination_wallet_id)
  VALUES (p_refund.payment_id, p_refund.integration_id, p_refund.attempt + 1, 'owed',
    'pvb-refund-' || p_refund.payment_id::text || '-' || (p_refund.attempt + 1)::text,
    p_refund.amount_kobo, p_refund.source_wallet_id, p_refund.destination_wallet_id);
END;
$$;

-- Work for the drain: confirmed-but-undelivered payments, owed refunds and
-- dispatched transfers awaiting a provider conclusion. Ids only.
CREATE FUNCTION piggyvest_primary.list_wallet_pay_work(
  integration_id uuid, environment text, max_rows integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(max_rows, 50), 1), 200);
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    list_wallet_pay_work.integration_id, list_wallet_pay_work.environment);
  RETURN pg_catalog.jsonb_build_object(
    -- Confirmed payments nobody delivered: left 15 minutes for the customer's
    -- own request first, so the drain never races a customer still waiting.
    'deliver', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'operationId', work.id, 'purpose', work.purpose)) FROM (
        SELECT payment.id, payment.purpose FROM piggyvest_primary.wallet_payments AS payment
         WHERE payment.integration_id = list_wallet_pay_work.integration_id
           AND payment.state = 'confirmed'
           AND ((payment.fulfilment = 'awaiting' AND payment.settled_at <= v_now - interval '15 minutes')
                OR (payment.fulfilment = 'claimed'
                    AND payment.fulfilment_claimed_at <= v_now - interval '10 minutes'))
         ORDER BY piggyvest_primary.wallet_pay_rotation(payment.id) LIMIT v_limit) AS work), '[]'::jsonb),
    'refund', COALESCE((SELECT pg_catalog.jsonb_agg(work.payment_id) FROM (
        SELECT refund.payment_id FROM piggyvest_primary.wallet_payment_refunds AS refund
         WHERE refund.integration_id = list_wallet_pay_work.integration_id
           AND refund.state IN ('owed', 'dispatched')
         ORDER BY piggyvest_primary.wallet_pay_rotation(refund.id) LIMIT v_limit) AS work), '[]'::jsonb),
    'settle', COALESCE((SELECT pg_catalog.jsonb_agg(work.id) FROM (
        SELECT payment.id FROM piggyvest_primary.wallet_payments AS payment
         WHERE payment.integration_id = list_wallet_pay_work.integration_id
           AND (payment.state = 'dispatched'
                OR (payment.state = 'reserved' AND payment.reserved_at <= v_now - interval '5 minutes')
                -- A late success may still be indexed after a release; one
                -- proven while another attempt was unresolved stays listed
                -- until it is decided.
                OR (payment.state = 'released' AND payment.provider_transaction_id IS NULL
                    AND (payment.dispatched_at > v_now - interval '2 days'
                         OR payment.review_reason = 'late_success_deferred')))
         ORDER BY piggyvest_primary.wallet_pay_rotation(payment.id) LIMIT v_limit) AS work), '[]'::jsonb));
END;
$$;

-- 6. -------------------------------------------------------------------------
CREATE FUNCTION piggyvest_primary.read_dispatched_wallet_payment(
  integration_id uuid, environment text, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    read_dispatched_wallet_payment.integration_id, read_dispatched_wallet_payment.environment);
  SELECT pg_catalog.jsonb_build_object(
      'operationId', payment.id, 'purpose', payment.purpose, 'purchaseRef', payment.purchase_ref,
      'amountKobo', payment.amount_kobo, 'sourceWalletId', payment.source_wallet_id,
      'destinationWalletId', payment.destination_wallet_id, 'reference', payment.reference,
      'businessId', v_binding.business_id, 'providerCustomerId', intent.provider_customer_id)
    INTO v_result
    FROM piggyvest_primary.wallet_payments AS payment
    JOIN piggyvest_primary.onboarding_intents AS intent
      ON intent.id = payment.intent_id AND intent.integration_id = v_binding.id
   WHERE payment.id = read_dispatched_wallet_payment.operation_id
     AND payment.integration_id = v_binding.id
     AND (payment.state = 'dispatched' OR (payment.state = 'released' AND payment.dispatched_at IS NOT NULL))
     AND intent.provider_wallet_id = payment.source_wallet_id;
  RETURN v_result;
END;
$$;

CREATE FUNCTION piggyvest_primary.read_dispatched_wallet_refund(
  integration_id uuid, environment text, payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    read_dispatched_wallet_refund.integration_id, read_dispatched_wallet_refund.environment);
  SELECT pg_catalog.jsonb_build_object(
      'refundId', refund.id, 'operationId', refund.payment_id, 'amountKobo', refund.amount_kobo,
      'sourceWalletId', refund.source_wallet_id, 'destinationWalletId', refund.destination_wallet_id,
      'reference', refund.reference, 'businessId', v_binding.business_id,
      'providerCustomerId', intent.provider_customer_id)
    INTO v_result
    FROM piggyvest_primary.wallet_payment_refunds AS refund
    JOIN piggyvest_primary.wallet_payments AS payment ON payment.id = refund.payment_id
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = payment.intent_id
   WHERE refund.payment_id = read_dispatched_wallet_refund.payment_id
     AND refund.integration_id = v_binding.id
     AND (refund.state = 'dispatched' OR (refund.state = 'released' AND refund.dispatched_at IS NOT NULL))
     AND intent.provider_wallet_id = refund.destination_wallet_id
   ORDER BY (refund.state = 'dispatched') DESC, refund.attempt DESC LIMIT 1;
  RETURN v_result;
END;
$$;

-- One refund attempt by its exact reference (webhook attribution: a late
-- success of an earlier attempt must be judged as THAT attempt).
CREATE FUNCTION piggyvest_primary.read_wallet_refund_attempt(
  integration_id uuid, environment text, reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    read_wallet_refund_attempt.integration_id, read_wallet_refund_attempt.environment);
  SELECT pg_catalog.jsonb_build_object(
      'refundId', refund.id, 'operationId', refund.payment_id, 'amountKobo', refund.amount_kobo,
      'sourceWalletId', refund.source_wallet_id, 'destinationWalletId', refund.destination_wallet_id,
      'reference', refund.reference, 'businessId', v_binding.business_id,
      'providerCustomerId', intent.provider_customer_id)
    INTO v_result
    FROM piggyvest_primary.wallet_payment_refunds AS refund
    JOIN piggyvest_primary.wallet_payments AS payment ON payment.id = refund.payment_id
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = payment.intent_id
   WHERE refund.reference = read_wallet_refund_attempt.reference
     AND refund.integration_id = v_binding.id
     AND (refund.state = 'dispatched' OR (refund.state = 'released' AND refund.dispatched_at IS NOT NULL))
     AND intent.provider_wallet_id = refund.destination_wallet_id;
  RETURN v_result;
END;
$$;

-- Resolves an outflow webhook reference to a payment or refund.
CREATE FUNCTION piggyvest_primary.find_wallet_pay_transfer_by_reference(
  integration_id uuid, environment text, reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    find_wallet_pay_transfer_by_reference.integration_id, find_wallet_pay_transfer_by_reference.environment);
  SELECT pg_catalog.jsonb_build_object('kind', 'payment', 'operationId', payment.id,
      'reference', payment.reference,
      -- Already concluded by the status path: the webhook is acknowledged.
      'settled', payment.state IN ('confirmed', 'needs_review') AND payment.provider_transaction_id IS NOT NULL)
    INTO v_result
    FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.integration_id = v_binding.id
     AND payment.reference = find_wallet_pay_transfer_by_reference.reference
     AND payment.dispatched_at IS NOT NULL;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  SELECT pg_catalog.jsonb_build_object('kind', 'refund', 'operationId', refund.payment_id,
      'reference', refund.reference,
      'settled', refund.state IN ('confirmed', 'needs_review'))
    INTO v_result
    FROM piggyvest_primary.wallet_payment_refunds AS refund
   WHERE refund.integration_id = v_binding.id
     AND refund.reference = find_wallet_pay_transfer_by_reference.reference
     AND refund.dispatched_at IS NOT NULL;
  RETURN v_result;
END;
$$;

-- Settles a payment from a verified successful provider record. A non-zero
-- fee (fee rules are unconfirmed) records needs_review: money moved, but our
-- books will not call it a clean payment, and nothing is delivered. A late
-- success for a purchase another payment already covers is confirmed AND owes
-- a refund at once (the customer paid twice).
CREATE FUNCTION piggyvest_primary.settle_wallet_payment(integration_id uuid, environment text, proof jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
  v_fee bigint;
  v_other_state text;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    settle_wallet_payment.integration_id, settle_wallet_payment.environment);
  IF piggyvest_primary.wallet_pay_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = (proof ->> 'operationId')::uuid AND payment.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_payment.intent_id::text, 0));
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = v_payment.id FOR UPDATE;
  PERFORM 1 FROM piggyvest_primary.onboarding_intents AS intent
    JOIN public.customers AS customer
      ON customer.id = intent.customer_id AND customer.merchant_id = intent.merchant_id
     AND customer.user_id = intent.user_id
   WHERE intent.id = v_payment.intent_id AND intent.integration_id = v_binding.id
     AND intent.provider_wallet_id = v_payment.source_wallet_id
     FOR SHARE OF intent, customer;
  IF NOT FOUND
    OR v_payment.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_payment.reference IS DISTINCT FROM proof ->> 'reference'
    OR v_payment.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_payment.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_payment.state IN ('confirmed', 'needs_review') THEN
    RETURN CASE WHEN v_payment.provider_transaction_id = proof ->> 'providerTransactionId'
                THEN 'duplicate' ELSE 'conflict' END;
  END IF;
  IF NOT (v_payment.state = 'dispatched'
          OR (v_payment.state = 'released' AND v_payment.dispatched_at IS NOT NULL)) THEN
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payments AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS other
                WHERE other.integration_id = v_binding.id
                  AND other.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  v_fee := COALESCE((proof ->> 'feeKobo')::bigint, 0);
  IF v_payment.state = 'released' THEN
    -- A late success: the provider indexed the transfer after it was released.
    -- Lock the purchase so a concurrent issue cannot race this decision.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'wallet-pay:' || v_binding.id::text || ':' || v_payment.purpose || ':' || v_payment.purchase_ref, 0));
    SELECT live.state INTO v_other_state FROM piggyvest_primary.wallet_payments AS live
     WHERE live.integration_id = v_binding.id AND live.purpose = v_payment.purpose
       AND live.purchase_ref = v_payment.purchase_ref AND live.id <> v_payment.id
       AND piggyvest_primary.wallet_payment_is_live(live.state, live.fulfilment);
    IF v_other_state IN ('reserved', 'dispatched', 'needs_review') THEN
      -- Another attempt for the purchase is still unresolved: decide nothing
      -- now. The drain re-checks released-after-dispatch payments, and once
      -- the other attempt resolves this one settles as a duplicate (refund)
      -- or as the payment.
      UPDATE piggyvest_primary.wallet_payments SET review_reason = 'late_success_deferred'
       WHERE id = v_payment.id;
      RETURN 'deferred';
    END IF;
    IF v_other_state = 'confirmed' THEN
      -- The customer paid twice: this payment can never be delivered, so it is
      -- confirmed straight into refund_owed (outside the live index) and the
      -- refund is opened in the same transaction.
      UPDATE piggyvest_primary.wallet_payments
         SET state = 'confirmed', provider_transaction_id = proof ->> 'providerTransactionId',
             settled_at = pg_catalog.clock_timestamp(), fulfilment = 'refund_owed',
             fulfilment_finished_at = pg_catalog.clock_timestamp(),
             review_reason = CASE WHEN v_fee > 0 THEN 'fee_charged' ELSE 'duplicate_payment' END
       WHERE id = v_payment.id
       RETURNING * INTO v_payment;
      PERFORM piggyvest_primary.open_wallet_payment_refund(v_payment);
      RETURN 'refunding';
    END IF;
  END IF;
  IF v_fee > 0 THEN
    -- Fee rules are unconfirmed: money moved, but our books will not call it
    -- a clean payment and nothing is delivered. A person decides. The
    -- provider id is recorded so a replay answers duplicate.
    UPDATE piggyvest_primary.wallet_payments
       SET state = 'needs_review', provider_transaction_id = proof ->> 'providerTransactionId',
           settled_at = pg_catalog.clock_timestamp(), review_reason = 'fee_charged'
     WHERE id = v_payment.id;
    RETURN 'needs_review';
  END IF;
  UPDATE piggyvest_primary.wallet_payments
     SET state = 'confirmed', provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp(), review_reason = NULL
   WHERE id = v_payment.id;
  RETURN 'confirmed';
END;
$$;

CREATE FUNCTION piggyvest_primary.release_failed_wallet_payment(integration_id uuid, environment text, proof jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    release_failed_wallet_payment.integration_id, release_failed_wallet_payment.environment);
  IF piggyvest_primary.wallet_pay_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = (proof ->> 'operationId')::uuid AND payment.integration_id = v_binding.id
     FOR UPDATE;
  IF NOT FOUND
    OR v_payment.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_payment.reference IS DISTINCT FROM proof ->> 'reference'
    OR v_payment.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_payment.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_payment.state = 'released' THEN RETURN 'duplicate'; END IF;
  IF v_payment.state = 'needs_review' THEN
    RETURN CASE WHEN v_payment.provider_transaction_id = proof ->> 'providerTransactionId'
                THEN 'duplicate' ELSE 'conflict' END;
  END IF;
  IF v_payment.state <> 'dispatched' THEN RETURN 'conflict'; END IF;
  -- A failed record that still charged a fee moved money: never released
  -- (a retry could charge again); a person decides.
  IF COALESCE((proof ->> 'feeKobo')::bigint, 0) > 0 THEN
    UPDATE piggyvest_primary.wallet_payments
       SET state = 'needs_review', provider_transaction_id = proof ->> 'providerTransactionId',
           settled_at = pg_catalog.clock_timestamp(), review_reason = 'failed_with_fee'
     WHERE id = v_payment.id;
    RETURN 'needs_review';
  END IF;
  UPDATE piggyvest_primary.wallet_payments SET state = 'released' WHERE id = v_payment.id;
  RETURN 'released';
END;
$$;

-- Settles a refund attempt from a verified successful provider record. The
-- payment's fulfilment becomes 'refunded'. A fee records needs_review.
CREATE FUNCTION piggyvest_primary.settle_wallet_refund(integration_id uuid, environment text, proof jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_refund piggyvest_primary.wallet_payment_refunds%ROWTYPE;
  v_fee bigint;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    settle_wallet_refund.integration_id, settle_wallet_refund.environment);
  IF piggyvest_primary.wallet_pay_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = (proof ->> 'operationId')::uuid AND payment.integration_id = v_binding.id
     FOR UPDATE;
  SELECT refund.* INTO v_refund FROM piggyvest_primary.wallet_payment_refunds AS refund
   WHERE refund.payment_id = (proof ->> 'operationId')::uuid
     AND refund.integration_id = v_binding.id AND refund.reference = proof ->> 'reference'
     FOR UPDATE;
  IF NOT FOUND
    OR v_refund.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_refund.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_refund.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_refund.state IN ('confirmed', 'needs_review') THEN
    RETURN CASE WHEN v_refund.provider_transaction_id = proof ->> 'providerTransactionId'
                THEN 'duplicate' ELSE 'conflict' END;
  END IF;
  IF NOT (v_refund.state = 'dispatched'
          OR (v_refund.state = 'released' AND v_refund.dispatched_at IS NOT NULL)) THEN
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payments AS other
                WHERE other.integration_id = v_binding.id
                  AND other.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  -- A late success of a released attempt while a newer attempt is live would
  -- refund twice if both went through: a person decides.
  IF v_refund.state = 'released' AND EXISTS (
      SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS live
       WHERE live.payment_id = v_refund.payment_id AND live.id <> v_refund.id
         AND live.state IN ('owed', 'dispatched', 'confirmed', 'needs_review')) THEN
    -- A newer attempt never sent is retired (the DELETE re-checks 'owed'
    -- under the row lock, so one the worker dispatched meanwhile is kept).
    DELETE FROM piggyvest_primary.wallet_payment_refunds
     WHERE payment_id = v_refund.payment_id AND id <> v_refund.id AND state = 'owed';
    -- Anything still live could refund too: a person decides.
    IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS live
                WHERE live.payment_id = v_refund.payment_id AND live.id <> v_refund.id
                  AND live.state IN ('owed', 'dispatched', 'confirmed', 'needs_review')) THEN
      UPDATE piggyvest_primary.wallet_payments SET review_reason = 'late_refund_success'
       WHERE id = v_refund.payment_id;
      RETURN 'needs_review';
    END IF;
  END IF;
  v_fee := COALESCE((proof ->> 'feeKobo')::bigint, 0);
  UPDATE piggyvest_primary.wallet_payment_refunds
     SET state = CASE WHEN v_fee > 0 THEN 'needs_review' ELSE 'confirmed' END,
         review_reason = CASE WHEN v_fee > 0 THEN 'fee_charged' ELSE NULL END,
         provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp()
   WHERE id = v_refund.id;
  UPDATE piggyvest_primary.wallet_payments SET fulfilment = 'refunded'
   WHERE id = v_refund.payment_id AND fulfilment = 'refund_owed';
  RETURN CASE WHEN v_fee > 0 THEN 'needs_review' ELSE 'confirmed' END;
END;
$$;

-- A provider record showing a refund attempt FAILED releases it and opens the
-- next attempt under a fresh reference.
CREATE FUNCTION piggyvest_primary.release_failed_wallet_refund(integration_id uuid, environment text, proof jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_refund piggyvest_primary.wallet_payment_refunds%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    release_failed_wallet_refund.integration_id, release_failed_wallet_refund.environment);
  IF piggyvest_primary.wallet_pay_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT refund.* INTO v_refund FROM piggyvest_primary.wallet_payment_refunds AS refund
   WHERE refund.payment_id = (proof ->> 'operationId')::uuid
     AND refund.integration_id = v_binding.id AND refund.reference = proof ->> 'reference'
     FOR UPDATE;
  IF NOT FOUND
    OR v_refund.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_refund.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_refund.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_refund.state = 'released' THEN RETURN 'duplicate'; END IF;
  IF v_refund.state = 'needs_review' THEN
    RETURN CASE WHEN v_refund.provider_transaction_id = proof ->> 'providerTransactionId'
                THEN 'duplicate' ELSE 'conflict' END;
  END IF;
  IF v_refund.state <> 'dispatched' THEN RETURN 'conflict'; END IF;
  IF COALESCE((proof ->> 'feeKobo')::bigint, 0) > 0 THEN
    UPDATE piggyvest_primary.wallet_payment_refunds
       SET state = 'needs_review', provider_transaction_id = proof ->> 'providerTransactionId',
           review_reason = 'failed_with_fee', settled_at = pg_catalog.clock_timestamp()
     WHERE id = v_refund.id;
    UPDATE piggyvest_primary.wallet_payments SET review_reason = 'refund_failed_with_fee'
     WHERE id = v_refund.payment_id;
    RETURN 'needs_review';
  END IF;
  PERFORM piggyvest_primary.next_wallet_refund_attempt(v_refund);
  RETURN 'released';
END;
$$;

-- Daily reconciliation: read-only lists (ids and ages only) of everything
-- that should have finished by now. options is reserved (pass {}), so the
-- evidence executor can call it with its fixed three-parameter shape.
CREATE FUNCTION piggyvest_primary.read_wallet_pay_reconciliation(integration_id uuid, environment text, options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff timestamptz := pg_catalog.clock_timestamp() - interval '30 minutes';
BEGIN
  PERFORM piggyvest_primary.assert_wallet_pay_evidence(
    read_wallet_pay_reconciliation.integration_id, read_wallet_pay_reconciliation.environment);
  RETURN pg_catalog.jsonb_build_object(
    'stuckPayments', COALESCE((SELECT pg_catalog.jsonb_agg(row_data) FROM (
        SELECT pg_catalog.jsonb_build_object('operationId', payment.id, 'state', payment.state,
                 'reservedAt', payment.reserved_at) AS row_data
          FROM piggyvest_primary.wallet_payments AS payment
         WHERE payment.integration_id = read_wallet_pay_reconciliation.integration_id
           AND payment.state IN ('reserved', 'dispatched') AND payment.reserved_at <= v_cutoff
         ORDER BY payment.reserved_at LIMIT 200) AS stuck), '[]'::jsonb),
    'undelivered', COALESCE((SELECT pg_catalog.jsonb_agg(row_data) FROM (
        SELECT pg_catalog.jsonb_build_object('operationId', payment.id, 'fulfilment', payment.fulfilment,
                 'settledAt', payment.settled_at) AS row_data
          FROM piggyvest_primary.wallet_payments AS payment
         WHERE payment.integration_id = read_wallet_pay_reconciliation.integration_id
           AND payment.state = 'confirmed' AND payment.fulfilment IN ('awaiting', 'claimed')
           AND payment.settled_at <= v_cutoff
         ORDER BY payment.settled_at LIMIT 200) AS stuck), '[]'::jsonb),
    'unrefunded', COALESCE((SELECT pg_catalog.jsonb_agg(row_data) FROM (
        SELECT pg_catalog.jsonb_build_object('operationId', payment.id,
                 'reviewReason', payment.review_reason, 'finishedAt', payment.fulfilment_finished_at) AS row_data
          FROM piggyvest_primary.wallet_payments AS payment
         WHERE payment.integration_id = read_wallet_pay_reconciliation.integration_id
           AND payment.fulfilment = 'refund_owed' AND payment.fulfilment_finished_at <= v_cutoff
         ORDER BY payment.fulfilment_finished_at LIMIT 200) AS stuck), '[]'::jsonb),
    'needsReview', COALESCE((SELECT pg_catalog.jsonb_agg(row_data) FROM (
        SELECT pg_catalog.jsonb_build_object('operationId', payment.id,
                 'reviewReason', payment.review_reason) AS row_data
          FROM piggyvest_primary.wallet_payments AS payment
         WHERE payment.integration_id = read_wallet_pay_reconciliation.integration_id
           AND (payment.state = 'needs_review' OR payment.review_reason IS NOT NULL OR EXISTS (
             SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS refund
              WHERE refund.payment_id = payment.id AND refund.state = 'needs_review'))
         ORDER BY payment.issued_at LIMIT 200) AS review), '[]'::jsonb));
END;
$$;

-- 7. -------------------------------------------------------------------------
-- Customer deletion waits for unsettled payments and refunds: settlement needs
-- the live customer row, and a refund owed must reach the customer first.
CREATE FUNCTION piggyvest_primary.block_unsettled_wallet_pay_customer_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.wallet_payments AS payment
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = payment.intent_id
    WHERE intent.customer_id = OLD.id
      AND (payment.state IN ('reserved', 'dispatched', 'needs_review')
           OR payment.review_reason IS NOT NULL
           OR (payment.state = 'confirmed' AND payment.fulfilment IN ('awaiting', 'claimed', 'refund_owed'))
           -- A released send can still be indexed as a late success.
           OR (payment.state = 'released' AND payment.dispatched_at > pg_catalog.clock_timestamp() - interval '2 days'
               AND payment.provider_transaction_id IS NULL)
           OR EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payment_refunds AS refund
                       WHERE refund.payment_id = payment.id
                         AND (refund.state IN ('owed', 'dispatched', 'needs_review')
                              OR (refund.state = 'released'
                                  AND refund.dispatched_at > pg_catalog.clock_timestamp() - interval '2 days'))))
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled wallet payments' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER primary_wallet_pay_block_unsettled_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_wallet_pay_customer_deletion();

-- 8. -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  piggyvest_primary.assert_wallet_pay_worker(uuid, text),
  piggyvest_primary.assert_wallet_pay_evidence(uuid, text),
  piggyvest_primary.wallet_payment_is_live(text, text),
  piggyvest_primary.wallet_pay_pin_key(piggyvest_primary.wallet_payments),
  piggyvest_primary.wallet_pay_proof_valid(jsonb),
  piggyvest_primary.open_wallet_payment_refund(piggyvest_primary.wallet_payments),
  piggyvest_primary.next_wallet_refund_attempt(piggyvest_primary.wallet_payment_refunds),
  piggyvest_primary.issue_wallet_payment(jsonb, jsonb),
  piggyvest_primary.read_issued_wallet_payment(jsonb, uuid),
  piggyvest_primary.reserve_wallet_payment_with_pin(jsonb, jsonb, text),
  piggyvest_primary.manage_wallet_payment(jsonb, uuid, text),
  piggyvest_primary.read_wallet_payment_status(jsonb, uuid),
  piggyvest_primary.read_wallet_payment_for_purchase(jsonb, jsonb),
  piggyvest_primary.claim_wallet_payment_fulfilment(uuid, text, uuid),
  piggyvest_primary.finish_wallet_payment_fulfilment(uuid, text, uuid, text, uuid),
  piggyvest_primary.read_owed_wallet_refund(uuid, text, uuid),
  piggyvest_primary.manage_wallet_refund(uuid, text, uuid, text),
  piggyvest_primary.list_wallet_pay_work(uuid, text, integer),
  piggyvest_primary.release_stale_wallet_payment(uuid, text, uuid),
  piggyvest_primary.wallet_pay_rotation(uuid),
  piggyvest_primary.read_dispatched_wallet_payment(uuid, text, uuid),
  piggyvest_primary.read_dispatched_wallet_refund(uuid, text, uuid),
  piggyvest_primary.read_wallet_refund_attempt(uuid, text, text),
  piggyvest_primary.find_wallet_pay_transfer_by_reference(uuid, text, text),
  piggyvest_primary.settle_wallet_payment(uuid, text, jsonb),
  piggyvest_primary.release_failed_wallet_payment(uuid, text, jsonb),
  piggyvest_primary.settle_wallet_refund(uuid, text, jsonb),
  piggyvest_primary.release_failed_wallet_refund(uuid, text, jsonb),
  piggyvest_primary.read_wallet_pay_reconciliation(uuid, text, jsonb),
  piggyvest_primary.block_unsettled_wallet_pay_customer_deletion()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  piggyvest_primary.issue_wallet_payment(jsonb, jsonb),
  piggyvest_primary.read_issued_wallet_payment(jsonb, uuid),
  piggyvest_primary.reserve_wallet_payment_with_pin(jsonb, jsonb, text),
  piggyvest_primary.manage_wallet_payment(jsonb, uuid, text),
  piggyvest_primary.read_wallet_payment_status(jsonb, uuid),
  piggyvest_primary.read_wallet_payment_for_purchase(jsonb, jsonb),
  piggyvest_primary.claim_wallet_payment_fulfilment(uuid, text, uuid),
  piggyvest_primary.finish_wallet_payment_fulfilment(uuid, text, uuid, text, uuid),
  piggyvest_primary.read_owed_wallet_refund(uuid, text, uuid),
  piggyvest_primary.manage_wallet_refund(uuid, text, uuid, text),
  piggyvest_primary.list_wallet_pay_work(uuid, text, integer),
  piggyvest_primary.release_stale_wallet_payment(uuid, text, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION
  piggyvest_primary.read_dispatched_wallet_payment(uuid, text, uuid),
  piggyvest_primary.read_dispatched_wallet_refund(uuid, text, uuid),
  piggyvest_primary.read_wallet_refund_attempt(uuid, text, text),
  piggyvest_primary.find_wallet_pay_transfer_by_reference(uuid, text, text),
  piggyvest_primary.settle_wallet_payment(uuid, text, jsonb),
  piggyvest_primary.release_failed_wallet_payment(uuid, text, jsonb),
  piggyvest_primary.settle_wallet_refund(uuid, text, jsonb),
  piggyvest_primary.release_failed_wallet_refund(uuid, text, jsonb),
  piggyvest_primary.read_wallet_pay_reconciliation(uuid, text, jsonb)
  TO piggyvest_primary_evidence;

COMMIT;
