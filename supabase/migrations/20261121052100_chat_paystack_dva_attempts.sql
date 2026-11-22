-- Fence concurrent and indeterminate Paystack account requests from chat.
-- Reservation and webhook matching continue to use order_payment_accounts.
CREATE TABLE IF NOT EXISTS private.chat_paystack_dva_attempts (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  reference text NOT NULL,
  prior_assignment_at timestamptz
);
ALTER TABLE private.chat_paystack_dva_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.chat_paystack_dva_attempts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_chat_paystack_dva_attempt(p_tracking_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claims jsonb := auth.jwt()->'paystack_dva_attempt';
  order_row public.orders%ROWTYPE;
  account public.order_payment_accounts%ROWTYPE;
  attempt private.chat_paystack_dva_attempts%ROWTYPE;
  requested_order_id uuid;
  amount_kobo numeric;
  new_reference text := claims->>'reference';
  payment_reference text;
  pending jsonb := '{"kind":"pending"}';
  refused jsonb := '{"kind":"refused"}';
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
    OR claims IS NULL
    OR coalesce(new_reference, '') !~ '^BAC-[A-Z0-9]{12}$'
    OR coalesce(claims->>'amount_kobo', '') !~ '^[1-9][0-9]{0,14}$' THEN
    RETURN refused;
  END IF;
  requested_order_id := (claims->>'order_id')::uuid;
  amount_kobo := (claims->>'amount_kobo')::numeric;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || requested_order_id::text, 0)
  );
  SELECT o.* INTO order_row FROM public.orders o
  WHERE o.id = requested_order_id
    AND o.merchant_id = (claims->>'merchant_id')::uuid
    AND lower(btrim(o.customer_email)) = claims->>'customer_email'
    AND o.payment_method = 'bank_transfer';
  IF NOT FOUND THEN RETURN refused; END IF;
  -- The chat bridge derives this key. The prefix only selects the rollout;
  -- possession of the order tracking token authorizes recovery below.
  IF coalesce(order_row.checkout_idempotency_key, '') !~ '^cw-chk-[0-9a-f]{64}$' THEN
    RETURN '{"kind":"legacy"}';
  END IF;
  IF nullif(p_tracking_token, '') IS NULL
    OR order_row.tracking_token IS DISTINCT FROM p_tracking_token
    OR order_row.currency IS DISTINCT FROM 'NGN'
    OR order_row.payment_status NOT IN ('unpaid', 'pending')
    OR lower(order_row.shipping_status) IN ('cancelled', 'canceled')
    OR coalesce(order_row.amount_paid, 0) <> 0
    OR coalesce(order_row.wallet_amount_used, 0) <> 0
    OR order_row.total * 100 IS DISTINCT FROM amount_kobo THEN
    RETURN refused;
  END IF;

  SELECT a.* INTO attempt FROM private.chat_paystack_dva_attempts a
  WHERE a.order_id = order_row.id;
  SELECT a.* INTO account FROM public.order_payment_accounts a
  WHERE a.order_id = order_row.id AND a.provider = 'paystack'
  ORDER BY a.assigned_at DESC NULLS LAST, a.created_at DESC NULLS LAST, a.id DESC
  LIMIT 1;

  -- LEAST ignores a NULL expires_at. A row with no assigned_at may be a legacy
  -- live account, so it is fenced rather than treated as expired.
  IF account.order_id IS NOT NULL AND (
    account.assigned_at IS NULL OR
    least(account.expires_at, account.assigned_at + interval '90 minutes') > clock_timestamp()
  ) THEN
    IF account.assigned_at IS NULL
      OR account.assigned_at + interval '60 minutes' <= clock_timestamp()
      OR account.assignment_customer_email IS DISTINCT FROM claims->>'customer_email'
      OR account.payable_amount * 100 IS DISTINCT FROM amount_kobo
      OR (attempt.order_id IS NOT NULL AND account.assigned_at IS NOT DISTINCT FROM attempt.prior_assignment_at)
    THEN
      RETURN pending;
    END IF;

    -- A completed initialization has both a saved assignment and a transaction.
    -- If the first request stopped between the two writes, preserve the fence.
    SELECT t.gateway_reference INTO payment_reference FROM public.transactions t
    WHERE t.order_id = order_row.id AND t.merchant_id = order_row.merchant_id
      AND t.gateway = 'paystack' AND t.transaction_type = 'payment'
      AND t.status = 'pending' AND t.amount * 100 = amount_kobo
      AND t.metadata->>'paystack_payment_type' = 'dva'
      AND (
        (attempt.order_id IS NULL AND t.created_at >= account.assigned_at)
        OR t.gateway_reference = attempt.reference
      )
    ORDER BY t.created_at DESC, t.id DESC LIMIT 1;
    IF nullif(payment_reference, '') IS NULL THEN RETURN pending; END IF;

    RETURN pg_catalog.jsonb_build_object(
      'kind', 'saved', 'reference', payment_reference,
      'dva', pg_catalog.jsonb_build_object(
        'account_number', account.account_number, 'account_name', account.account_name,
        'bank_name', account.bank_name
      )
    );
  END IF;

  -- Refresh an expired, known assignment. A claim with no corresponding
  -- persisted assignment may already have reached Paystack and stays fenced.
  IF attempt.order_id IS NOT NULL AND
    (account.assigned_at IS NULL OR account.assigned_at IS NOT DISTINCT FROM attempt.prior_assignment_at) THEN
    RETURN pending;
  END IF;

  -- Newest-row selection must not hide an older legacy row of unknown state.
  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts a
    WHERE a.order_id = order_row.id AND a.provider = 'paystack'
      AND a.assigned_at IS NULL
  ) THEN
    RETURN pending;
  END IF;

  INSERT INTO private.chat_paystack_dva_attempts(order_id, reference, prior_assignment_at)
  VALUES (order_row.id, new_reference, account.assigned_at)
  ON CONFLICT ON CONSTRAINT chat_paystack_dva_attempts_pkey DO UPDATE
    SET reference = excluded.reference, prior_assignment_at = excluded.prior_assignment_at;
  RETURN '{"kind":"claimed"}';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN refused;
END;
$$;
ALTER FUNCTION public.begin_chat_paystack_dva_attempt(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.begin_chat_paystack_dva_attempt(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_chat_paystack_dva_attempt(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
