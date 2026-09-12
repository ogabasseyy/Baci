-- Persist awaiting_payment atomically when a pickup repair is created so a
-- failed post-create mark cannot leave a null/null bookable unpaid row.

CREATE OR REPLACE FUNCTION private.create_repair_booking(
  p_merchant_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_device_type text,
  p_device_model text,
  p_issue_description text,
  p_preferred_date timestamptz DEFAULT NULL,
  p_service_type text DEFAULT 'dropoff',
  p_pickup_address text DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,
  p_quote_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, ticket_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_repair_id uuid := gen_random_uuid();
  v_ticket integer;
  v_customer_name text := btrim(coalesce(p_customer_name, ''));
  v_normalized_email text := lower(btrim(coalesce(p_customer_email, '')));
  v_customer_phone text := btrim(coalesce(p_customer_phone, ''));
  v_device_type text := btrim(coalesce(p_device_type, ''));
  v_device_model text := btrim(coalesce(p_device_model, ''));
  v_issue_description text := btrim(coalesce(p_issue_description, ''));
  v_service_type text := lower(btrim(coalesce(p_service_type, 'dropoff')));
  v_pickup_address text := nullif(btrim(coalesce(p_pickup_address, '')), '');
  v_catalog_enabled boolean;
  v_quoted_price numeric(12, 2);
  v_repair_type_label text;
  v_resolved_device_id uuid;
  v_resolved_device_type text := v_device_type;
  v_resolved_device_model text := v_device_model;
  v_per_email_count integer;
  v_per_merchant_count integer;
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.merchants AS m WHERE m.id = p_merchant_id) THEN
    RAISE EXCEPTION 'merchant_not_found' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_customer_name) < 2 OR char_length(v_customer_name) > 100 THEN
    RAISE EXCEPTION 'invalid_customer_name' USING ERRCODE = '22023';
  END IF;

  IF v_normalized_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_customer_email' USING ERRCODE = '22023';
  END IF;

  IF v_customer_phone !~ '^\+?[0-9[:space:]-]{10,}$' THEN
    RAISE EXCEPTION 'invalid_customer_phone' USING ERRCODE = '22023';
  END IF;

  IF v_device_type NOT IN ('Smartphone', 'Laptop', 'Tablet', 'Console', 'Smartwatch', 'Other') THEN
    RAISE EXCEPTION 'invalid_device_type' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_device_model) < 2 THEN
    RAISE EXCEPTION 'invalid_device_model' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_issue_description) < 10 THEN
    RAISE EXCEPTION 'invalid_issue_description' USING ERRCODE = '22023';
  END IF;

  IF v_service_type NOT IN ('dropoff', 'pickup') THEN
    RAISE EXCEPTION 'invalid_service_type' USING ERRCODE = '22023';
  END IF;

  IF v_service_type = 'pickup' AND (v_pickup_address IS NULL OR char_length(v_pickup_address) < 5) THEN
    RAISE EXCEPTION 'invalid_pickup_address' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_per_email_count
  FROM public.repairs AS r
  WHERE r.merchant_id = p_merchant_id
    AND lower(btrim(r.customer_email)) = v_normalized_email
    AND r.created_at > (now() - interval '1 hour');
  IF v_per_email_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_per_merchant_count
  FROM public.repairs AS r
  WHERE r.merchant_id = p_merchant_id
    AND r.created_at > (now() - interval '1 hour');
  IF v_per_merchant_count >= 100 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '22023';
  END IF;

  v_catalog_enabled := public.repairs_catalog_publicly_enabled(p_merchant_id);

  IF p_quote_id IS NOT NULL THEN
    IF NOT v_catalog_enabled THEN
      RAISE EXCEPTION 'catalog_disabled' USING ERRCODE = '22023';
    END IF;

    SELECT
      rq.price,
      st.name,
      rq.device_id,
      coalesce(nullif(btrim(rd.device_type), ''), v_device_type),
      coalesce(nullif(btrim(rd.model), ''), v_device_model)
      INTO
        v_quoted_price,
        v_repair_type_label,
        v_resolved_device_id,
        v_resolved_device_type,
        v_resolved_device_model
    FROM public.repair_quotes AS rq
    JOIN public.repair_devices AS rd
      ON rd.id = rq.device_id AND rd.merchant_id = rq.merchant_id
    JOIN public.repair_service_types AS st
      ON st.id = rq.service_type_id AND st.merchant_id = rq.merchant_id
    WHERE rq.id = p_quote_id
      AND rq.merchant_id = p_merchant_id
      AND rq.is_active
      AND rd.is_active
      AND st.is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote_unavailable' USING ERRCODE = '22023';
    END IF;

    IF p_device_id IS NOT NULL AND p_device_id <> v_resolved_device_id THEN
      RAISE EXCEPTION 'device_quote_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF p_device_id IS NOT NULL THEN
    IF NOT v_catalog_enabled THEN
      RAISE EXCEPTION 'catalog_disabled' USING ERRCODE = '22023';
    END IF;

    SELECT
      rd.id,
      coalesce(nullif(btrim(rd.device_type), ''), v_device_type),
      coalesce(nullif(btrim(rd.model), ''), v_device_model)
      INTO v_resolved_device_id, v_resolved_device_type, v_resolved_device_model
    FROM public.repair_devices AS rd
    WHERE rd.id = p_device_id
      AND rd.merchant_id = p_merchant_id
      AND rd.is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'device_unavailable' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.repairs (
    id, merchant_id, customer_name, customer_email, customer_phone,
    device_type, device_model, issue_description, preferred_date,
    service_type, pickup_address, status,
    device_id, quote_id, quoted_price, repair_type_label,
    pickup_payment_status
  )
  VALUES (
    v_repair_id, p_merchant_id, v_customer_name, v_normalized_email, v_customer_phone,
    v_resolved_device_type, v_resolved_device_model, v_issue_description, p_preferred_date,
    v_service_type, v_pickup_address, 'pending',
    v_resolved_device_id, p_quote_id, v_quoted_price, v_repair_type_label,
    CASE
      WHEN v_service_type = 'pickup' THEN 'awaiting_payment'
      ELSE NULL
    END
  )
  RETURNING repairs.id, repairs.ticket_number
  INTO v_repair_id, v_ticket;

  RETURN QUERY SELECT v_repair_id AS id, v_ticket AS ticket_number;
END;
$$;

COMMENT ON FUNCTION private.create_repair_booking(
  uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid
) IS
  'SECURITY DEFINER booking write; pickup rows insert with pickup_payment_status=awaiting_payment so unpaid pickups are never null/null bookable.';

REVOKE ALL ON FUNCTION private.create_repair_booking(
  uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.create_repair_booking(
  uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid
) TO anon, authenticated, service_role;
