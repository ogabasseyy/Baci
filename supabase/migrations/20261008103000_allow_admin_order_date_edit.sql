-- Take the per-order payment advisory lock before the outermost admin-edit
-- wrapper locks the order row, matching the lock order used by payment
-- refresh and webhook RPCs (advisory, then row). Lives in this same
-- migration as the date wrapper so no intermediate state ever exposes the
-- inverted call chain.
ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  RENAME TO update_admin_order_with_transaction_discount_metadata_without_payment_lock;
REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata_without_payment_lock(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_admin_order_with_transaction_discount_metadata(
  p_order_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  RETURN public.update_admin_order_with_transaction_discount_metadata_without_payment_lock(
    p_order_id,
    p_payload
  );
END;
$$;

ALTER FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)
  IS 'Takes the per-order payment advisory lock, then applies an admin order edit with negotiated discount cleanup.';

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
  v_source text;
  v_final_docs record;
  v_date timestamptz;
  v_instant_changed boolean := false;
  v_day_changed boolean := false;
  v_doc_day date;
  v_doc_day_override date;
  v_doc_day_text text;
  v_result jsonb;
  v_changed_fields text[] := ARRAY[]::text[];
  v_delegated_audit_count integer := 0;
  v_delegated_audit_id uuid;
  v_before_dates jsonb;
  v_after_dates jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- Re-entrant with the outermost wrapper: harmless when the edit entered
  -- through it, and keeps the payment lock order for direct callers.
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
    -- No lower bound by design: merchants may correct arbitrarily old
    -- manual sales, matching update_transaction_review_details.
    IF v_date IS NULL OR NOT isfinite(v_date) THEN
      RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
    END IF;
    -- Instant-based future check is intentionally stricter than the
    -- review path's merchant-day comparison: backdates target past dates,
    -- mobile always sends local midnight, and direct API callers get exact
    -- fail-closed semantics.
    IF v_date > now() THEN
      RAISE EXCEPTION 'order_date_in_future' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Explicit device-local calendar day, mirroring order creation. It must
  -- be a plausible rendering of the same instant: a device-local day
  -- differs from the UTC day by at most one.
  IF p_payload ? 'transaction_date_day' THEN
    v_doc_day_text := p_payload ->> 'transaction_date_day';
    IF jsonb_typeof(p_payload -> 'transaction_date_day') <> 'string'
      OR v_doc_day_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_doc_day_override := v_doc_day_text::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
    END;
    IF v_date IS NULL
      OR abs(v_doc_day_override - (v_date AT TIME ZONE 'UTC')::date) > 1 THEN
      RAISE EXCEPTION 'order_date_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Exact-instant no-op is intentional: clients omit unchanged days, so a
  -- sent date normally means the day changed; direct API callers get exact
  -- semantics. A differing explicit day also counts when the instant
  -- happens to match, so cross-timezone day corrections are honored.
  v_instant_changed := v_date IS NOT NULL
    AND v_date IS DISTINCT FROM
      COALESCE(v_order.transaction_date, v_order.created_at);

  IF (v_instant_changed OR v_doc_day_override IS NOT NULL)
    AND v_order.shipping_status IN ('cancelled', 'returned') THEN
    RAISE EXCEPTION 'order_terminal_not_editable' USING ERRCODE = '23514';
  END IF;

  v_result := public.update_admin_order_without_date(
    p_order_id, p_payload - 'transaction_date' - 'transaction_date_day'
  );

  -- The same edit may change the sales channel: classify manual status
  -- from the post-edit source, not the pre-edit snapshot.
  SELECT o.source INTO v_source
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_source IN ('manual', 'staff_entry', 'physical', 'instagram',
      'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga')
    AND v_doc_day_override IS NOT NULL
    AND (
      v_doc_day_override IS DISTINCT FROM v_order.invoice_issue_date
      OR v_doc_day_override IS DISTINCT FROM v_order.tax_point_date
      OR v_order.invoice_issue_date_generated IS DISTINCT FROM false
      OR v_order.tax_point_date_generated IS DISTINCT FROM false
    ) THEN
    v_day_changed := true;
  END IF;

  IF v_instant_changed OR v_day_changed THEN
    -- Manual-origin orders carry explicit device-local document dates that
    -- the sync trigger preserves by design, so move them with the corrected
    -- day and keep them explicit (mirroring
    -- update_transaction_review_details). Prefer the client-sent calendar
    -- day over re-deriving from the instant in the merchant timezone, which
    -- can shift the day when device and merchant timezones straddle
    -- midnight; fall back to merchant-timezone derivation for older clients.
    -- Generated dates on other orders follow via the trigger; explicit ones
    -- stay untouched.
    IF v_source IN ('manual', 'staff_entry', 'physical', 'instagram',
        'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga') THEN
      v_doc_day := COALESCE(v_doc_day_override, (
        v_date AT TIME ZONE public.manual_order_timezone(v_order.merchant_id)
      )::date);
    END IF;

    UPDATE public.orders
      SET transaction_date = CASE
            WHEN v_instant_changed THEN v_date ELSE transaction_date END,
          updated_at = now(),
          invoice_issue_date = CASE
            WHEN v_doc_day IS NOT NULL
             AND v_doc_day IS DISTINCT FROM invoice_issue_date
            THEN v_doc_day ELSE invoice_issue_date END,
          -- Clear whenever a manual day is supplied, even when the date
          -- value already matches: a lingering generated flag would let the
          -- sync trigger replace the device-selected day.
          invoice_issue_date_generated = CASE
            WHEN v_doc_day IS NOT NULL
            THEN false ELSE invoice_issue_date_generated END,
          tax_point_date = CASE
            WHEN v_doc_day IS NOT NULL
             AND v_doc_day IS DISTINCT FROM tax_point_date
            THEN v_doc_day ELSE tax_point_date END,
          tax_point_date_generated = CASE
            WHEN v_doc_day IS NOT NULL
            THEN false ELSE tax_point_date_generated END
      WHERE id = p_order_id;

    -- Re-read after the sync trigger so the audit captures document dates
    -- the trigger rewrote, not just this statement's explicit overrides.
    SELECT o.invoice_issue_date, o.invoice_issue_date_generated,
           o.tax_point_date, o.tax_point_date_generated
      INTO v_final_docs
    FROM public.orders o
    WHERE o.id = p_order_id;

    IF v_instant_changed THEN
      v_changed_fields := array_append(v_changed_fields, 'transaction_date');
    END IF;
    IF v_final_docs.invoice_issue_date IS DISTINCT FROM v_order.invoice_issue_date
      OR v_final_docs.invoice_issue_date_generated IS DISTINCT FROM
        v_order.invoice_issue_date_generated THEN
      v_changed_fields := array_append(v_changed_fields, 'invoice_issue_date');
    END IF;
    IF v_final_docs.tax_point_date IS DISTINCT FROM v_order.tax_point_date
      OR v_final_docs.tax_point_date_generated IS DISTINCT FROM
        v_order.tax_point_date_generated THEN
      v_changed_fields := array_append(v_changed_fields, 'tax_point_date');
    END IF;

    v_before_dates := jsonb_build_object(
      'transaction_date', v_order.transaction_date,
      'effective_transaction_date',
        COALESCE(v_order.transaction_date, v_order.created_at),
      'invoice_issue_date', v_order.invoice_issue_date,
      'invoice_issue_date_generated', v_order.invoice_issue_date_generated,
      'tax_point_date', v_order.tax_point_date,
      'tax_point_date_generated', v_order.tax_point_date_generated);
    v_after_dates := jsonb_build_object(
      'transaction_date', CASE WHEN v_instant_changed
        THEN v_date ELSE v_order.transaction_date END,
      'effective_transaction_date', CASE WHEN v_instant_changed
        THEN v_date ELSE COALESCE(v_order.transaction_date, v_order.created_at) END,
      'invoice_issue_date', v_final_docs.invoice_issue_date,
      'invoice_issue_date_generated', v_final_docs.invoice_issue_date_generated,
      'tax_point_date', v_final_docs.tax_point_date,
      'tax_point_date_generated', v_final_docs.tax_point_date_generated);

    -- Merge into the audit event the delegated edit just wrote (same
    -- transaction) so one save produces one audit record; fall back to a
    -- standalone insert if the delegate wrote anything unexpected. Both the
    -- xmin and the creation timestamp must match the current transaction so
    -- a wrapped-around xid or a trigger-written row cannot misroute the merge.
    SELECT count(*)
      INTO v_delegated_audit_count
    FROM public.order_audit_events e
    WHERE e.order_id = p_order_id
      AND e.xmin = pg_current_xact_id()::xid
      AND e.created_at = now();

    IF v_delegated_audit_count = 1 THEN
      SELECT e.id
        INTO v_delegated_audit_id
      FROM public.order_audit_events e
      WHERE e.order_id = p_order_id
        AND e.xmin = pg_current_xact_id()::xid
        AND e.created_at = now();

      UPDATE public.order_audit_events
      SET changed_fields = changed_fields || v_changed_fields,
          before_snapshot = before_snapshot || v_before_dates,
          after_snapshot = after_snapshot || v_after_dates
      WHERE id = v_delegated_audit_id;
    ELSE
      INSERT INTO public.order_audit_events (
        merchant_id, order_id, actor_user_id, action, change_category,
        changed_fields, before_snapshot, after_snapshot, metadata
      ) VALUES (
        v_order.merchant_id, p_order_id, v_actor, 'order.update', 'internal',
        v_changed_fields, v_before_dates, v_after_dates,
        jsonb_build_object('change_category', 'internal', 'notify_customer', false)
      );
    END IF;
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
