-- The shared invoice can display the customer DVA and merchant bank card together.
-- Assert the previous predicates before changing only the two existing guards.
DO $migration$
DECLARE
  definition text;
  previous_dispatch text := $old$
    -- Rendered instructions only (non-NGN none, VA-only when
    -- selected, else merchant-bank card); either-side presence
    -- catches assignment and removal both ways.
    OR (v_compare_invoice_only
      AND upper(trim(COALESCE(v_order.currency, 'NGN'))) = 'NGN'
      AND ((v_va_account_number IS NOT NULL OR p_va_account_number IS NOT NULL)
        AND (v_va_account_number IS DISTINCT FROM p_va_account_number
          OR v_va_bank_name IS DISTINCT FROM p_va_bank_name
          OR v_va_account_name IS DISTINCT FROM p_va_account_name)
        OR (v_va_account_number IS NULL AND p_va_account_number IS NULL)
          AND (NULLIF(v_merchant_bank_account_number, '') IS NOT NULL OR NULLIF(p_merchant_bank_account_number, '') IS NOT NULL)
          AND (v_merchant_bank_account_number IS DISTINCT FROM p_merchant_bank_account_number
            OR private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code)
              IS DISTINCT FROM p_merchant_bank_name
            OR v_merchant_bank_account_name IS DISTINCT FROM p_merchant_bank_account_name)))
$old$;
  next_dispatch text := $new$
    -- Recheck both rendered cards independently.
    OR (v_compare_invoice_only
      AND v_order.total > COALESCE(v_order.amount_paid, 0)
      AND upper(trim(COALESCE(v_order.currency, 'NGN'))) = 'NGN'
      AND (
        v_va_account_number IS DISTINCT FROM p_va_account_number
        OR v_va_bank_name IS DISTINCT FROM p_va_bank_name
        OR v_va_account_name IS DISTINCT FROM p_va_account_name
        OR (CASE WHEN NULLIF(private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code), '') IS NOT NULL
              THEN NULLIF(v_merchant_bank_account_number, '') END)
            IS DISTINCT FROM p_merchant_bank_account_number
        OR (NULLIF(v_merchant_bank_account_number, '') IS NOT NULL
          AND NULLIF(private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code), '') IS NOT NULL
          AND (private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code)
                IS DISTINCT FROM p_merchant_bank_name
            OR v_merchant_bank_account_name IS DISTINCT FROM p_merchant_bank_account_name))
      ))
$new$;
  previous_rearm text := $old$      AND NOT EXISTS (
        SELECT 1 FROM public.order_payment_accounts AS opa
        WHERE opa.order_id = o.id
          AND (opa.assignment_customer_email_source IS NULL
            OR opa.assignment_customer_email_source <> 'legacy_untrusted')
          AND (opa.expires_at IS NULL
            OR opa.expires_at > now() + interval '15 minutes')
          AND (COALESCE(opa.assigned_at, opa.created_at) IS NULL
            OR COALESCE(opa.assigned_at, opa.created_at) <= now()))$old$;
BEGIN
  SELECT pg_get_functiondef('public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb, date, text, text, text, text)'::regprocedure)
    INTO definition;
  IF strpos(definition, trim(leading E'\n' FROM previous_dispatch)) = 0 THEN
    RAISE EXCEPTION 'Expected manual invoice dispatch guard is missing';
  END IF;
  EXECUTE replace(definition, trim(leading E'\n' FROM previous_dispatch), trim(leading E'\n' FROM next_dispatch));

  SELECT pg_get_functiondef('private.rearm_manual_documents_after_merchant_update()'::regprocedure)
    INTO definition;
  IF strpos(definition, previous_rearm) = 0 THEN
    RAISE EXCEPTION 'Expected merchant invoice rearm guard is missing';
  END IF;
  EXECUTE replace(definition, previous_rearm,
    $guard$      AND o.total > COALESCE(o.amount_paid, 0)
      AND ((NULLIF(OLD.bank_account_number, '') IS NOT NULL
            AND private.resolved_merchant_bank_name(OLD.bank_name, OLD.bank_code) <> '')
        OR (NULLIF(NEW.bank_account_number, '') IS NOT NULL
            AND private.resolved_merchant_bank_name(NEW.bank_name, NEW.bank_code) <> ''))$guard$);
END;
$migration$;
