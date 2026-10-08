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
  v_date timestamptz;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT o.merchant_id, o.transaction_date, o.created_at, o.shipping_status
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

    UPDATE public.orders
      SET transaction_date = v_date, updated_at = now()
      WHERE id = p_order_id;

    INSERT INTO public.order_audit_events (
      merchant_id, order_id, actor_user_id, action, change_category,
      changed_fields, before_snapshot, after_snapshot, metadata
    ) VALUES (
      v_order.merchant_id, p_order_id, v_actor, 'order.update', 'internal',
      ARRAY['transaction_date'],
      jsonb_build_object('transaction_date', v_order.transaction_date,
        'effective_transaction_date', COALESCE(v_order.transaction_date, v_order.created_at)),
      jsonb_build_object('transaction_date', v_date, 'effective_transaction_date', v_date),
      jsonb_build_object('change_category', 'internal', 'notify_customer', false)
    );
    v_result := jsonb_set(v_result, '{changed_fields}',
      COALESCE(v_result -> 'changed_fields', '[]'::jsonb)
      || jsonb_build_array('transaction_date'));
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.update_admin_order(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_admin_order(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_admin_order(uuid, jsonb) TO authenticated;
