-- Alias-conflicted DVA assignment must leave pending so a later funding
-- attempt can provision a different receiver. Persist the operator review in
-- the same service-role call the webhook already uses.

CREATE OR REPLACE FUNCTION public.reject_merchant_wallet_funding_alias_conflict(
  p_request_id uuid,
  p_merchant_id uuid,
  p_account_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.merchant_wallet_funding_account_requests
  SET status = 'failed'
  WHERE id = p_request_id
    AND merchant_id = p_merchant_id
    AND status = 'pending';

  INSERT INTO public.reconciliation_review (
    issue_type,
    merchant_id,
    paystack_ref,
    reason,
    candidates,
    metadata
  ) VALUES (
    'wallet_dva_order_alias_conflict',
    p_merchant_id,
    'merchant-wallet-funding:' || p_request_id::text,
    'Paystack assigned a merchant-wallet dedicated account already reserved by another flow.',
    '[]'::jsonb,
    jsonb_build_object(
      'request_id', p_request_id,
      'account_number', p_account_number
    )
  )
  ON CONFLICT (issue_type, paystack_ref)
    WHERE resolved_at IS NULL AND paystack_ref IS NOT NULL
  DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_merchant_wallet_funding_alias_conflict(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_merchant_wallet_funding_alias_conflict(uuid, uuid, text)
  TO service_role;
