-- Pending refund evidence helper: the manager's global pending sum
-- as a reviewable unit, split from the manager (part 4) so each
-- migration stays under the 300-line limit. Called only from
-- private.manage_order_refund, which runs SECURITY DEFINER; this
-- stays SECURITY INVOKER.
DROP FUNCTION IF EXISTS private.pending_refund_evidence_v1(uuid,uuid,text,boolean,text);
CREATE OR REPLACE FUNCTION private.pending_refund_evidence_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text,
  p_sole_external_leg boolean, p_sole_leg_gateway text
) RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Pending stays a global sum: over-counting in-flight money only
  -- blocks actions safely. Nonmatching-currency rows (null or
  -- foreign) stay out of coverage but count as pending: the manager
  -- cannot convert money, so an unexplained linked row must block
  -- recording until reconciliation instead of leaving the full
  -- balance recordable beside it (double-record). No currency
  -- filtering on the scan for this reason: it would drop the row
  -- from both sums.
  RETURN (SELECT
    COALESCE(sum(amount) FILTER (WHERE status NOT IN ('completed','refunded','failed')
      OR (status IN ('completed','refunded')
        AND (public.normalized_gateway_name_v1(gateway) IS NOT DISTINCT FROM 'PAYSTACK'
          OR (public.normalized_gateway_name_v1(gateway)='MANUAL'
            AND metadata->>'method'='paystack'))
        AND metadata->>'provider_refund_status' IS DISTINCT FROM 'processed')
      OR (status IN ('completed','refunded')
        AND upper(btrim(currency)) IS DISTINCT FROM upper(btrim(
          COALESCE(NULLIF(BTRIM(p_currency),''),'NGN'))))
      OR (status IN ('completed','refunded')
        AND NOT COALESCE((EXISTS (SELECT 1 FROM public.transactions leg
            WHERE leg.id::text = transactions.metadata->>'payment_transaction_id'
              AND leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
              AND leg.transaction_type='payment'
              AND (public.normalized_gateway_name_v1(transactions.gateway)='MANUAL'
                OR public.normalized_gateway_name_v1(transactions.gateway)
                  =public.normalized_gateway_name_v1(leg.gateway)))
          OR (transactions.metadata->>'payment_transaction_id' IS NULL
            AND p_sole_external_leg
            AND public.normalized_gateway_name_v1(gateway)=p_sole_leg_gateway)),false))),0)
    FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=p_merchant_id AND transaction_type='refund'
  );
  -- No link predicate above: a row claiming a leg outside this
  -- order (or otherwise unresolvable) must reach the FILTER's
  -- mismatch branch and hold pending, not vanish from both sums.
  -- Excluding it would leave the full balance recordable beside
  -- possibly real provider money (double-record) while the claim
  -- finalizes past evidence nothing ever reconciles. The mismatch
  -- test compares links as text so a malformed link blocks
  -- instead of raising.
END; $$;
REVOKE ALL ON FUNCTION private.pending_refund_evidence_v1(uuid,uuid,text,boolean,text)
  FROM PUBLIC,anon,authenticated;
-- Mirrors the record helper: service_role fires the manager, and
-- authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.pending_refund_evidence_v1(uuid,uuid,text,boolean,text)
  TO service_role, authenticated;
