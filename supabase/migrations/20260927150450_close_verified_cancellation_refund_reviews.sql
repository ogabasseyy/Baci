-- Close cancellation-refund reviews once every funded gateway leg is
-- provider-verified complete. Split out of
-- 20260927150500_complete_legacy_paystack_cancellation_refunds.sql to keep
-- each migration under the 300-line maximum; this step must apply before
-- it. Reviews that record unresolved provider evidence (audit failures,
-- ambiguous initiation) stay open for operations.
CREATE OR REPLACE FUNCTION public.close_verified_cancellation_refund_reviews_v1(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Every payment leg is provider-verified complete, so the cancellation
  -- saga is done regardless of which metadata shape the open reviews
  -- carry (top-level IDs, accepted leg lists, or merged evidence).
  -- Reviews that record a provider-accepted refund with no local audit row
  -- (audit_record_failed) stay open until their provider refund ID matches
  -- a completed local refund row: closing them on other legs' evidence
  -- would drop an unreconciled customer refund.
  UPDATE public.reconciliation_review review
    SET resolved_at = now(),
        resolution_notes = 'Paystack verified all cancelled-order gateway refunds'
    WHERE review.order_id = p_order_id
      AND review.merchant_id = p_merchant_id
      AND review.issue_type = 'order_cancellation_refund_requires_review'
      AND review.resolved_at IS NULL
      AND (
        review.metadata->>'audit_record_failed' IS DISTINCT FROM 'true'
        OR EXISTS (
          SELECT 1 FROM public.transactions r
          WHERE r.order_id = p_order_id AND r.merchant_id = p_merchant_id
            AND r.transaction_type = 'refund' AND public.normalized_gateway_name_v1(r.gateway) = 'PAYSTACK'
            AND r.status = 'completed'
            -- A locally completed row resolves audit-failed evidence only
            -- after provider verification: other writers can complete a
            -- row without it, and closing on status alone would drop an
            -- unreconciled or duplicate provider refund.
            AND r.metadata->>'provider_refund_status' = 'processed'
            AND r.gateway_reference = review.metadata->>'provider_refund_id'
        )
      )
      -- Ambiguous initiation evidence is never auto-resolved: the
      -- original request may have created a provider refund no audit
      -- row records, and closing on a replacement's coverage would hide
      -- the undiscovered duplicate. New filings record the verdict
      -- explicitly; only legacy ambiguous filings carry a lone
      -- failed_payment_transaction_id with no marker at all (accepted
      -- legs prove a partial deterministic failure instead); merged
      -- legs carry it under their leg key. Only operations (or a future
      -- provider-evidence check) resolves that uncertainty.
      -- Compare flag text directly: casting to boolean raises on a
      -- corrupt value and would roll back the verified refund
      -- transition on every retry. Only an explicit 'false' (or a
      -- missing flag) passes; anything else stays open for
      -- operations.
      AND (
        review.metadata->>'ambiguous_initiation' IS NULL
        OR review.metadata->>'ambiguous_initiation' = 'false'
      )
      AND (
        review.metadata->>'failed_payment_transaction_id' IS NULL
        OR review.metadata ? 'accepted_refund_ids'
        OR review.metadata->>'ambiguous_initiation' = 'false'
      )
      -- Malformed refund evidence (array, string, scalar) keeps the
      -- review open for operations: jsonb_each raises on non-objects,
      -- which would roll back the verified refund transition, order
      -- transition, settlement reversal, and notification enqueue on
      -- every retry.
      AND jsonb_typeof(
        coalesce(review.metadata->'refund_evidence', '{}'::jsonb)
      ) = 'object'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each(coalesce(review.metadata->'refund_evidence', '{}'::jsonb)) AS e(key, value)
        -- Text comparison, not a boolean cast: a corrupt flag must
        -- block closure instead of raising, and only an explicit
        -- 'false' clears.
        WHERE (e.value->>'audit_record_failed') <> 'false'
          AND e.key LIKE 'provider:%'
          AND NOT EXISTS (
            SELECT 1 FROM public.transactions r
            WHERE r.order_id = p_order_id AND r.merchant_id = p_merchant_id
              AND r.transaction_type = 'refund' AND public.normalized_gateway_name_v1(r.gateway) = 'PAYSTACK'
              AND r.status = 'completed'
              AND r.metadata->>'provider_refund_status' = 'processed'
              AND r.gateway_reference = split_part(e.key, ':', 2)
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each(coalesce(review.metadata->'refund_evidence', '{}'::jsonb)) AS e(key, value)
        WHERE e.key LIKE 'leg:%'
          AND (e.value->>'ambiguous') <> 'false'
      );
END;
$$;
REVOKE ALL ON FUNCTION public.close_verified_cancellation_refund_reviews_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_verified_cancellation_refund_reviews_v1(uuid, uuid)
  TO service_role;
