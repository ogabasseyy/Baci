-- Operators can clear an abandoned claim after reconciling it with Paystack.
-- Keep this off PostgREST and share the reservation's per-order lock.
ALTER TABLE private.chat_paystack_dva_attempts
  ADD COLUMN claimed_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE FUNCTION private.refresh_chat_paystack_dva_claimed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.claimed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_chat_paystack_dva_claimed_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER refresh_chat_paystack_dva_claimed_at
BEFORE UPDATE OF reference ON private.chat_paystack_dva_attempts
FOR EACH ROW EXECUTE FUNCTION private.refresh_chat_paystack_dva_claimed_at();

CREATE FUNCTION private.release_unfulfilled_chat_paystack_dva_attempt(
  p_order_id uuid,
  p_reference text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_order_id IS NULL OR coalesce(p_reference, '') !~ '^BAC-[A-Z0-9]{12}$' THEN
    RETURN false;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  DELETE FROM private.chat_paystack_dva_attempts AS attempt
  USING public.orders AS o
  WHERE attempt.order_id = p_order_id
    AND attempt.reference = p_reference
    AND attempt.claimed_at < clock_timestamp() - interval '15 minutes'
    AND o.id = attempt.order_id
    AND o.payment_method = 'bank_transfer'
    AND o.payment_status IN ('unpaid', 'pending')
    AND lower(o.shipping_status) NOT IN ('cancelled', 'canceled')
    AND coalesce(o.amount_paid, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.order_payment_accounts AS account
      WHERE account.order_id = attempt.order_id AND account.provider = 'paystack'
        AND (
          account.assigned_at IS NULL
          OR account.assigned_at IS DISTINCT FROM attempt.prior_assignment_at
          OR least(account.expires_at, account.assigned_at + interval '90 minutes')
            > clock_timestamp()
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions AS txn
      WHERE txn.gateway = 'paystack' AND txn.gateway_reference = attempt.reference
    );
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION private.release_unfulfilled_chat_paystack_dva_attempt(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.release_unfulfilled_chat_paystack_dva_attempt(uuid, text)
  TO postgres;
