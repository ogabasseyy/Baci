-- Trusted importers verify the signed export before calling this RPC. Bind
-- every receipt to the signer's merchant inside the same transaction.
CREATE FUNCTION public.import_paid_order_tender_receipts(
  p_merchant_id uuid,p_source_id text,p_receipts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  receipt record;
  evidence_ids jsonb := '[]'::jsonb;
  evidence_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'bank_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  IF p_merchant_id IS NULL OR COALESCE(p_source_id,'') !~ '^[a-z0-9_-]{3,32}$'
    OR jsonb_typeof(p_receipts) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'tender_evidence_required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_receipts) NOT BETWEEN 1 AND 50 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_receipts) AS entry(value)
    WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
  ) THEN RAISE EXCEPTION 'tender_evidence_required' USING ERRCODE = '22023'; END IF;

  -- Acquire the same locks as the single-receipt importer and confirmation.
  -- Sort order IDs so concurrent imports acquire order locks consistently.
  PERFORM 1 FROM private.paid_order_amendment_config
  WHERE merchant_id = p_merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tender_evidence_required'; END IF;

  FOR receipt IN
    SELECT * FROM jsonb_to_recordset(p_receipts) AS r(
      "orderId" uuid,"method" text,"receiptReference" text,"reconciliationReference" text,
      "amountMinor" bigint,"occurredAt" timestamptz
    )
    ORDER BY r."orderId", r."method", upper(r."receiptReference")
  LOOP
    IF receipt."orderId" IS NULL
      OR COALESCE(receipt."reconciliationReference",'') !~ '^[A-Za-z0-9_.:/-]{8,120}$' THEN
      RAISE EXCEPTION 'tender_evidence_required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || receipt."orderId"::text,0));
    PERFORM 1 FROM public.orders WHERE id = receipt."orderId" AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'tender_evidence_required'; END IF;

    evidence_id := public.register_paid_order_tender_receipt(
      receipt."orderId",receipt."method",receipt."receiptReference",
      p_source_id || '/' || receipt."reconciliationReference",receipt."amountMinor",receipt."occurredAt"
    );
    evidence_ids := evidence_ids || jsonb_build_array(evidence_id);
  END LOOP;
  RETURN evidence_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.import_paid_order_tender_receipts(uuid,text,jsonb)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_paid_order_tender_receipts(uuid,text,jsonb) TO service_role;
