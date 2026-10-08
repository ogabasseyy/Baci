-- Keep date corrections atomic with the existing authorized, audited edit flow.
ALTER FUNCTION public.update_admin_order(uuid, jsonb)
  RENAME TO update_admin_order_without_date;
REVOKE ALL ON FUNCTION public.update_admin_order_without_date(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_admin_order(
  p_order_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order record;
  v_final_docs record;
  v_date timestamptz;
  v_doc_day date;
  v_result jsonb;
  v_changed_fields text[] := ARRAY['transaction_date'];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- Match the lock order used by payment refresh and webhook RPCs: take the
  -- per-order payment advisory lock before the order row, so a date
  -- correction racing a payment path cannot deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT o.merchant_id, o.source, o.transaction_date, o.created_at,
         o.shipping_status,
         o.invoice_issue_date, o.invoice_issue_date_generated,
         o.tax_point_date, o.tax_point_date_generated
    INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.merchants m
      WHERE m.id = v_order.merchant_id AND m.user_id = v_actor)
    OR public.check_staff_permission(v_actor, v_order.merchant_id, 'orders', 'edit')
  ) THEN
    RAISE EXCEPTION 'order_edit_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_payload ? 'transaction_date' THEN
    BEGIN
      IF jsonb_typeof(p_payload -> 'transaction_date') <> 'string' THEN
        RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
      END IF;
      v_date := (p_payload ->> 'transaction_date')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
    END;
    IF v_date IS NULL OR NOT isfinite(v_date) OR v_date > now() THEN
      RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_result := public.update_admin_order_without_date(
    p_order_id, p_payload - 'transaction_date'
  );

  IF v_date IS NOT NULL
    AND v_date IS DISTINCT FROM COALESCE(v_order.transaction_date, v_order.created_at)
  THEN
    IF v_order.shipping_status IN ('cancelled', 'returned') THEN
      RAISE EXCEPTION 'order_terminal_not_editable' USING ERRCODE = '23514';
    END IF;

    -- Manual-origin orders carry explicit device-local document dates that
    -- the sync trigger preserves by design, so move them with the corrected
    -- day and keep them explicit (mirroring
    -- update_transaction_review_details). Generated dates on other orders
    -- follow via the trigger; explicit ones stay untouched.
    IF v_order.source IN ('manual', 'staff_entry', 'physical', 'instagram',
        'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga') THEN
      v_doc_day := (
        v_date AT TIME ZONE public.manual_order_timezone(v_order.merchant_id)
      )::date;
    END IF;

    UPDATE public.orders
      SET transaction_date = v_date,
          updated_at = now(),
          invoice_issue_date = CASE
            WHEN v_doc_day IS NOT NULL
             AND v_doc_day IS DISTINCT FROM invoice_issue_date
            THEN v_doc_day ELSE invoice_issue_date END,
          invoice_issue_date_generated = CASE
            WHEN v_doc_day IS NOT NULL
             AND v_doc_day IS DISTINCT FROM invoice_issue_date
            THEN false ELSE invoice_issue_date_generated END,
          tax_point_date = CASE
            WHEN v_doc_day IS NOT NULL
             AND v_doc_day IS DISTINCT FROM tax_point_date
            THEN v_doc_day ELSE tax_point_date END,
          tax_point_date_generated = CASE
            WHEN v_doc_day IS NOT NULL
             AND v_doc_day IS DISTINCT FROM tax_point_date
            THEN false ELSE tax_point_date_generated END
      WHERE id = p_order_id;

    -- Re-read after the sync trigger so the audit captures document dates
    -- the trigger rewrote, not just this statement's explicit overrides.
    SELECT o.invoice_issue_date, o.tax_point_date
      INTO v_final_docs
    FROM public.orders o
    WHERE o.id = p_order_id;

    IF v_final_docs.invoice_issue_date IS DISTINCT FROM v_order.invoice_issue_date THEN
      v_changed_fields := array_append(v_changed_fields, 'invoice_issue_date');
    END IF;
    IF v_final_docs.tax_point_date IS DISTINCT FROM v_order.tax_point_date THEN
      v_changed_fields := array_append(v_changed_fields, 'tax_point_date');
    END IF;

    INSERT INTO public.order_audit_events (
      merchant_id, order_id, actor_user_id, action, change_category,
      changed_fields, before_snapshot, after_snapshot, metadata
    ) VALUES (
      v_order.merchant_id, p_order_id, v_actor, 'order.update', 'internal',
      v_changed_fields,
      jsonb_build_object('transaction_date', v_order.transaction_date,
        'effective_transaction_date', COALESCE(v_order.transaction_date, v_order.created_at),
        'invoice_issue_date', v_order.invoice_issue_date,
        'tax_point_date', v_order.tax_point_date),
      jsonb_build_object('transaction_date', v_date, 'effective_transaction_date', v_date,
        'invoice_issue_date', v_final_docs.invoice_issue_date,
        'tax_point_date', v_final_docs.tax_point_date),
      jsonb_build_object('change_category', 'internal', 'notify_customer', false)
    );
    v_result := jsonb_set(v_result, '{changed_fields}',
      COALESCE(v_result -> 'changed_fields', '[]'::jsonb)
      || to_jsonb(v_changed_fields));
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.update_admin_order(uuid, jsonb) OWNER TO postgres;
-- Force authenticated callers through the transaction-discount cleanup wrapper.
REVOKE ALL ON FUNCTION public.update_admin_order(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
