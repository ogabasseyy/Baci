-- Total returned money for the ledger-gap gate, shared by the
-- aggregate claim and the reconciliation finalization predicate:
-- per-leg coverage alone cannot authorize finalization on a drifted
-- order whose funded rows sum below amount_paid. Mirrors the
-- manager: per-leg-capped terminal coverage, self-terminal external
-- legs, and internal money. Internal money counts ONLY reversal-
-- ledger evidence (wallet order_reversal rows, savings reversed_at
-- rows): cancel reverses synchronously, so a funded wallet/savings
-- leg without reversal evidence is drift, not pending money, and
-- counting its face would finalize while the manager still reports
-- it outstanding. Currency normalizes to the NGN default like the
-- manager and coverage helpers.
CREATE OR REPLACE FUNCTION private.total_refund_returned_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text
) RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_currency text := COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN');
BEGIN
  RETURN private.capped_refund_coverage_v1(
      p_order_id, p_merchant_id, v_currency)
    + COALESCE((SELECT SUM(amount) FROM public.transactions
       WHERE order_id = p_order_id
         AND merchant_id = p_merchant_id
         AND transaction_type = 'payment' AND status = 'refunded'
         AND amount > 0
         AND UPPER(BTRIM(currency)) = UPPER(BTRIM(v_currency))
         AND COALESCE(public.normalized_gateway_name_v1(gateway), '')
           NOT IN ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH',
             'MANUAL', 'PAY_ON_DELIVERY')), 0)
    + COALESCE((SELECT SUM(t.amount)
         FROM public.customer_wallet_transactions t
        WHERE t.source_id = p_order_id
          AND t.merchant_id = p_merchant_id
          AND t.source_type = 'order_reversal'), 0)
    + COALESCE((SELECT SUM(r.amount)
         FROM public.customer_savings_redemptions r
        WHERE r.order_id = p_order_id
          AND r.merchant_id = p_merchant_id
          AND r.metadata ? 'reversed_at'), 0);
END; $$;
REVOKE ALL ON FUNCTION private.total_refund_returned_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
-- Mirrors the capped helper: service_role fires the claim, and
-- authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.total_refund_returned_v1(uuid,uuid,text)
  TO service_role, authenticated;
