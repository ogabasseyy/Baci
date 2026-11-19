-- Preserve review coverage for failed/expired Oxygen orders of any provenance.
-- Keep their budget within Oxygen, separate from standard follow-ups.
CREATE OR REPLACE FUNCTION public.oxygen_follow_up_candidates(p_merchant_id uuid)
RETURNS TABLE (order_id uuid, follow_up_status text, last_activity_at timestamptz, order_customer_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_merchant_id IS NULL
    OR public.has_merchant_access(p_merchant_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Merchant access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH relevant_orders AS (
    SELECT w.order_id AS id FROM public.oxygen_workflows w
    WHERE w.merchant_id = p_merchant_id AND w.environment = 'production'
    UNION
    SELECT o.id FROM public.orders o
    WHERE o.merchant_id = p_merchant_id AND o.payment_method = 'oxygen'
      AND o.created_at >= now() - interval '90 days'
  ), candidates AS (
    SELECT o.id, o.created_at, o.payment_status, o.payment_method, o.cancelled_at, o.customer_id,
      w.id AS workflow_id, w.stage, coalesce(s.state, '{}'::jsonb) AS state,
      (w.id IS NOT NULL AND w.customer_id IS DISTINCT FROM o.customer_id) AS binding_mismatch,
      greatest(coalesce(w.updated_at, o.created_at), coalesce(o.updated_at, o.created_at), pending.last_started_at, activation.created_at, activation.finished_at, recovery.last_activity_at, conflict.observed_at) AS activity_at,
      coalesce(pending.indeterminate, false) AS indeterminate,
      coalesce(pending.in_flight, false) AS in_flight,
      coalesce(recovery.indeterminate, false) AS recovery_indeterminate,
      coalesce(recovery.in_flight, false) AS recovery_in_flight,
      activation.status AS activation_status,
      (conflict.workflow_id IS NOT NULL) AS activation_conflict,
      coalesce(w.stage IN ('booked','approval_required','payment_required','ready_for_activation','activated')
        OR s.state ? 'bookingReference' OR s.state ? 'booking'
        OR EXISTS (SELECT 1 FROM oxygen_private.provider_reference_history h
          WHERE h.workflow_id = w.id AND h.booking_reference IS NOT NULL), false) AS has_booking,
      EXISTS (
        SELECT 1 FROM oxygen_private.commands c
        JOIN oxygen_private.provider_reference_history r ON r.command_id = c.id AND r.workflow_id = c.workflow_id
        WHERE c.workflow_id = w.id AND c.status = 'succeeded'
          AND c.command->>'action' = 'submit_address'
          AND r.booking_reference::text = s.state->>'bookingReference'
      ) AS address_submitted
    FROM relevant_orders relevant
    JOIN public.orders o ON o.id = relevant.id
    LEFT JOIN public.oxygen_workflows w ON w.order_id = o.id
      AND w.merchant_id = o.merchant_id
    LEFT JOIN oxygen_private.provider_states s ON s.workflow_id = w.id
    LEFT JOIN oxygen_private.general_activations activation ON activation.workflow_id = w.id
    LEFT JOIN oxygen_private.general_activation_reconcile_conflicts conflict
      ON conflict.workflow_id = w.id AND conflict.resolved_at IS NULL
    LEFT JOIN LATERAL (
      SELECT bool_or(c.status = 'indeterminate' AND NOT coalesce(
        c.command->>'action' = 'approve_booking'
        AND w.stage = 'activated'
        AND activation.status = 'activated'
        AND activation.booking_reference::text = s.state->>'bookingReference'
        AND activation.booking_reference::text = s.state->'booking'->>'loan_reference'
        AND s.state->'booking'->>'status' = 'ACTIVATED', false
      )) AS indeterminate,
        bool_or(c.status IN ('queued', 'executing')) AS in_flight,
        max(CASE WHEN c.status = 'executing' THEN coalesce(c.started_at, c.created_at)
          ELSE c.created_at END) FILTER (WHERE c.status IN ('queued', 'executing')) AS last_started_at
      FROM oxygen_private.commands c
      WHERE c.workflow_id = w.id AND c.status IN ('queued', 'executing', 'indeterminate')
    ) pending ON true
    LEFT JOIN LATERAL (
      SELECT bool_or(r.status = 'indeterminate' AND r.action IN ('resend_upfront','resend_repayment')) AS indeterminate,
        bool_or(r.status IN ('queued','executing')) AS in_flight,
        max(CASE
          WHEN r.status = 'indeterminate' THEN coalesce(r.completed_at, r.started_at, r.created_at)
          WHEN r.status = 'executing' THEN coalesce(r.started_at, r.created_at)
          ELSE r.created_at
        END) FILTER (WHERE r.status IN ('queued','executing')
          OR (r.status = 'indeterminate' AND r.action IN ('resend_upfront','resend_repayment'))) AS last_activity_at
      FROM oxygen_private.payment_recovery r
      WHERE r.workflow_id = w.id AND w.stage IS DISTINCT FROM 'activated'
        AND (s.state->>'bookingReference' IS NULL OR r.booking_reference::text = s.state->>'bookingReference')
        AND r.status IN ('queued','executing','indeterminate')
    ) recovery ON true
    WHERE o.merchant_id = p_merchant_id AND (o.payment_method = 'oxygen' OR w.id IS NOT NULL)
      AND (w.id IS NOT NULL
        OR (o.payment_method = 'oxygen' AND o.payment_status IN ('failed','expired'))
        OR (
        o.recorded_by_user_id IS NULL AND o.external_source IS NULL AND o.import_job_id IS NULL
        AND (o.source IS NULL OR o.source NOT IN ('physical','instagram','whatsapp','facebook','tiktok','jumia','jiji','konga','manual','staff_entry'))
      ))
      AND (w.id IS NULL OR w.environment = 'production')
  ), classified AS (
    SELECT c.*,
      (c.stage = 'reconciliation_required' OR c.indeterminate OR c.recovery_indeterminate OR c.activation_conflict
        OR (c.binding_mismatch AND c.has_booking)
        OR c.activation_status = 'indeterminate'
        OR (c.activation_status = 'activated' AND c.stage IS DISTINCT FROM 'activated')
        OR (c.activation_status = 'executing' AND c.stage = 'activated') OR
        (c.workflow_id IS NOT NULL AND c.has_booking AND
          (c.payment_method IS DISTINCT FROM 'oxygen' OR c.cancelled_at IS NOT NULL
            OR (c.stage IS DISTINCT FROM 'activated' AND c.payment_status IS DISTINCT FROM 'unpaid')
            OR (c.stage = 'activated' AND coalesce(c.payment_status, '') NOT IN ('unpaid','paid'))))) AS urgent_review,
      CASE
        WHEN c.stage = 'reconciliation_required' OR c.indeterminate OR c.in_flight OR c.recovery_indeterminate OR c.recovery_in_flight
          OR c.activation_conflict OR c.activation_status IN ('executing','indeterminate')
          OR (c.activation_status = 'activated' AND c.stage IS DISTINCT FROM 'activated') THEN 'needs_review'
        WHEN c.binding_mismatch THEN 'needs_review'
        WHEN c.workflow_id IS NOT NULL AND c.payment_method IS DISTINCT FROM 'oxygen' THEN 'needs_review'
        WHEN c.has_booking AND (c.cancelled_at IS NOT NULL
          OR (c.stage IS DISTINCT FROM 'activated' AND c.payment_status IS DISTINCT FROM 'unpaid')
          OR (c.stage = 'activated' AND coalesce(c.payment_status, '') NOT IN ('unpaid','paid')))
          THEN 'needs_review'
        WHEN c.payment_status IN ('failed','expired') OR c.state->>'eligibilityStatus' = 'failed'
          OR (c.state->>'eligibilityStatus' = 'completed' AND c.state->>'eligible' = 'false') THEN 'needs_review'
        WHEN c.payment_status = 'bnpl_approved' AND
          (c.stage NOT IN ('payment_required','ready_for_activation') OR c.state->'booking'->>'status' IS DISTINCT FROM 'APPROVED') THEN 'needs_review'
        WHEN c.stage IN ('payment_required','ready_for_activation')
          THEN CASE WHEN c.state->'booking'->>'status' = 'APPROVED' THEN 'approved_pending' ELSE 'needs_review' END
        WHEN c.state->'booking'->>'status' = 'APPROVED' THEN 'needs_review'
        WHEN c.state->>'eligibilityStatus' = 'pending'
          OR c.state->'kyc'->>'address_status' = 'PROCESSING'
          OR c.state->'kyc'->>'bank_status' = 'PROCESSING'
          OR c.state->'kyc'->>'selfie_status' = 'PROCESSING'
          OR c.state->'kyc'->>'bvn_status' = 'PROCESSING'
          OR c.state->'kyc'->>'nin_status' = 'PROCESSING'
          OR c.state->'kyc'->>'phone_status' = 'PROCESSING'
          OR (c.stage = 'booked' AND c.address_submitted
            AND c.state->'kyc'->>'address_status' = 'NOT_DONE') THEN 'oxygen_processing'
        WHEN c.stage = 'booked' AND c.state->'kyc'->>'address_status' IS DISTINCT FROM 'NOT_DONE' THEN 'needs_review'
        WHEN c.workflow_id IS NULL OR c.stage IN ('application_required','eligibility_required','kyc_required','plan_required','booked','approval_required') THEN 'customer_action'
        ELSE 'needs_review'
      END AS status
    FROM candidates c
  ), ranked AS (
    SELECT c.*, row_number() OVER (
      PARTITION BY coalesce(c.urgent_review, false), (c.status = 'needs_review')
      ORDER BY c.activity_at DESC, c.id
    ) AS category_rank
    FROM classified c
  WHERE (c.stage IS DISTINCT FROM 'activated' OR c.urgent_review)
    AND (c.payment_method = 'oxygen' OR c.has_booking OR c.indeterminate OR c.in_flight
      OR c.recovery_indeterminate OR c.recovery_in_flight OR c.activation_status IS NOT NULL
      OR c.activation_conflict OR c.stage = 'reconciliation_required')
    AND (
      (c.cancelled_at IS NULL AND c.payment_status IN ('pending','unpaid','bnpl_pending','bnpl_approved','failed','expired'))
      OR c.urgent_review
    )
    AND (c.created_at >= now() - interval '90 days' OR c.urgent_review)
    AND (c.activity_at < now() - interval '30 minutes' OR c.urgent_review
      OR c.payment_status IN ('failed','expired'))
  )
  SELECT c.id, c.status, c.activity_at,
    CASE WHEN c.status = 'customer_action' THEN c.customer_id END
  FROM ranked c
  -- Keep the urgent/routine split; share routine capacity between active and review-only rows.
  ORDER BY row_number() OVER (PARTITION BY coalesce(c.urgent_review, false)
    ORDER BY c.category_rank, (c.status = 'needs_review'), c.activity_at DESC, c.id),
    coalesce(c.urgent_review, false) DESC
  LIMIT 250;
END;
$$;

REVOKE ALL ON FUNCTION public.oxygen_follow_up_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oxygen_follow_up_candidates(uuid) TO authenticated;
COMMENT ON FUNCTION public.oxygen_follow_up_candidates(uuid) IS
  'Merchant-scoped Oxygen categories including failed staff/imported orders; bounded admission interleaves urgent/routine ranks. Clients group reviews independently; no provider secrets.';
