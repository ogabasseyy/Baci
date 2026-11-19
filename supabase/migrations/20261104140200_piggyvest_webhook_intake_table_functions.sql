-- GL-D (part 2): the receiver's own table operations as narrow SECURITY
-- DEFINER functions. Each does exactly one statement the service-role client
-- used to run through the REST API, so the restricted login never needs a
-- table privilege. Inputs are one jsonb object; casts reject malformed values.
-- Insert functions return the inserted keys ([] on a duplicate); read
-- functions return the row or null.

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.inbox_insert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid inbox request' USING ERRCODE = '22023';
  END IF;
  WITH inserted AS (
    INSERT INTO public.piggyvest_webhook_inbox (
      event_id, event_type, event_category, customer_id, wallet_id, reference,
      amount_kobo, event_details, status)
    VALUES (p->>'event_id', p->>'event_type', p->>'event_category', p->>'customer_id',
      p->>'wallet_id', p->>'reference', (p->>'amount_kobo')::bigint,
      NULLIF(p->'event_details', 'null'::jsonb), 'pending')
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id', event_id)), '[]'::jsonb)
    INTO result FROM inserted;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.inbox_read(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid inbox request' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT event_type, event_category, customer_id, wallet_id, reference, amount_kobo, event_details
    FROM public.piggyvest_webhook_inbox WHERE event_id = p->>'event_id') AS r;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.quarantine_insert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid quarantine request' USING ERRCODE = '22023';
  END IF;
  WITH inserted AS (
    INSERT INTO public.piggyvest_event_quarantine (event_id, event_type, body_digest, reason, detail)
    VALUES (p->>'event_id', p->>'event_type', p->>'body_digest', p->>'reason',
      NULLIF(p->'detail', 'null'::jsonb))
    ON CONFLICT (body_digest) DO NOTHING
    RETURNING body_digest)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('body_digest', body_digest)), '[]'::jsonb)
    INTO result FROM inserted;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.inflow_credit_insert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid inflow request' USING ERRCODE = '22023';
  END IF;
  WITH inserted AS (
    INSERT INTO public.piggyvest_inflow_credits (
      provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
      amount_kobo, fee_kobo, reference, session_id, credited_at)
    VALUES (p->>'provider_transaction_id', p->>'event_data_id', p->>'event_id',
      p->>'customer_id', p->>'wallet_id', (p->>'amount_kobo')::bigint,
      (p->>'fee_kobo')::bigint, p->>'reference', p->>'session_id',
      (p->>'credited_at')::timestamptz)
    ON CONFLICT (provider_transaction_id) DO NOTHING
    RETURNING provider_transaction_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('provider_transaction_id', provider_transaction_id)), '[]'::jsonb)
    INTO result FROM inserted;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.inflow_credit_read(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid inflow request' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT customer_id, wallet_id, amount_kobo, fee_kobo, reference, session_id, event_data_id, credited_at
    FROM public.piggyvest_inflow_credits
    WHERE provider_transaction_id = p->>'provider_transaction_id') AS r;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.interest_payout_insert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid interest request' USING ERRCODE = '22023';
  END IF;
  WITH inserted AS (
    INSERT INTO public.piggyvest_interest_payouts (
      provider_payout_id, event_id, customer_id, wallet_id, amount_kobo, gross_kobo,
      withholding_tax_kobo, net_kobo, reference, batch_id, paid_at)
    VALUES (p->>'provider_payout_id', p->>'event_id', p->>'customer_id', p->>'wallet_id',
      (p->>'amount_kobo')::bigint, (p->>'gross_kobo')::bigint,
      (p->>'withholding_tax_kobo')::bigint, (p->>'net_kobo')::bigint,
      p->>'reference', p->>'batch_id', (p->>'paid_at')::timestamptz)
    ON CONFLICT (provider_payout_id) DO NOTHING
    RETURNING provider_payout_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('provider_payout_id', provider_payout_id)), '[]'::jsonb)
    INTO result FROM inserted;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.interest_payout_read(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid interest request' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT customer_id, wallet_id, amount_kobo, gross_kobo, withholding_tax_kobo,
      net_kobo, reference, batch_id, paid_at
    FROM public.piggyvest_interest_payouts
    WHERE provider_payout_id = p->>'provider_payout_id') AS r;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.plan_wallet_read(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid wallet request' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT customer_id, merchant_id, piggyvest_customer_id, wallet_id, status
    FROM public.piggyvest_plan_wallets WHERE wallet_id = p->>'wallet_id') AS r;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.plan_wallet_set_status(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
    OR p->>'status' IS NULL OR p->>'status' NOT IN ('restricted', 'ready', 'provisioning') THEN
    RAISE EXCEPTION 'Invalid wallet status request' USING ERRCODE = '22023';
  END IF;
  WITH updated AS (
    UPDATE public.piggyvest_plan_wallets
    SET status = p->>'status', updated_at = pg_catalog.now()
    WHERE wallet_id = p->>'wallet_id'
    RETURNING wallet_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('wallet_id', wallet_id)), '[]'::jsonb)
    INTO result FROM updated;
  RETURN result;
END;
$$;

-- Terminal outflow state for a row we submitted: only submitted -> succeeded or
-- failed, never any other transition.
CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.outbox_apply_terminal(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
    OR p->>'status' IS NULL OR p->>'status' NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'Invalid outbox request' USING ERRCODE = '22023';
  END IF;
  WITH updated AS (
    UPDATE public.piggyvest_transfer_outbox
    SET status = p->>'status', updated_at = pg_catalog.now()
    WHERE reference = p->>'reference' AND status = 'submitted'
    RETURNING reference)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', reference)), '[]'::jsonb)
    INTO result FROM updated;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_webhook_intake.inbox_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.inbox_read(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.quarantine_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.inflow_credit_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.inflow_credit_read(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.interest_payout_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.interest_payout_read(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.plan_wallet_read(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.plan_wallet_set_status(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.outbox_apply_terminal(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.inbox_insert(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.inbox_read(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.quarantine_insert(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.inflow_credit_insert(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.inflow_credit_read(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.interest_payout_insert(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.interest_payout_read(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.plan_wallet_read(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.plan_wallet_set_status(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.outbox_apply_terminal(jsonb) TO piggyvest_webhook_intake;
