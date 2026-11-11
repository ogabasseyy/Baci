-- The shared invoice can display the customer DVA and merchant bank card together.
-- Keep the legacy RPC available during the rollout. Only a v2 mark uses the
-- expanded rearm rules for a document already at the transport boundary.
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
  legacy_bank_guard text := $old$      AND NOT EXISTS (
        SELECT 1 FROM public.order_payment_accounts AS opa
        WHERE opa.order_id = o.id
          AND (opa.assignment_customer_email_source IS NULL
            OR opa.assignment_customer_email_source <> 'legacy_untrusted')
          AND (opa.expires_at IS NULL
            OR opa.expires_at > now() + interval '15 minutes')
          AND (COALESCE(opa.assigned_at, opa.created_at) IS NULL
            OR COALESCE(opa.assigned_at, opa.created_at) <= now()))$old$;
  legacy_dispatch regprocedure := 'public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb, date, text, text, text, text)'::regprocedure;
  shared_dispatch_name text := 'public.mark_manual_document_dispatch_started_v2';
  legacy_dispatch_name text := 'public.mark_manual_document_dispatch_started';
  signature text;
  source text;
  dispatch_edits text[][] := ARRAY[
    ARRAY['  v_merchant_tax_identification_number text;',
      E'  v_merchant_cac_rc_number text;\n  v_merchant_tax_identification_number text;'],
    ARRAY['m.registered_address, m.tax_identification_number,',
      'm.registered_address, m.cac_rc_number, m.tax_identification_number,'],
    ARRAY['    v_merchant_tax_identification_number,',
      '    v_merchant_cac_rc_number, v_merchant_tax_identification_number,'],
    ARRAY['    -- cac prints nowhere; VAT inputs compare below for rowless taxed invoices.',
      '    OR NULLIF(v_merchant_cac_rc_number, '''') IS DISTINCT FROM NULLIF(p_merchant_cac_rc_number, '''')'],
    ARRAY['jsonb_build_object(''sent_document_kind'', p_document_kind)',
      'jsonb_build_object(''sent_document_kind'', p_document_kind, ''shared_invoice_claim_owner'', p_claim_owner)']
  ];
  rearm_edits text[][] := ARRAY[
    ARRAY['  v_bank_changed boolean;',
      E'  v_bank_changed boolean;\n  v_registration_changed boolean;'],
    ARRAY['  v_shared_changed :=',
      E'  v_registration_changed := NULLIF(OLD.cac_rc_number, '''') IS DISTINCT FROM NULLIF(NEW.cac_rc_number, '''');\n  v_shared_changed :='],
    ARRAY['  -- field (VAT inputs over-broad for receipts, but one-shot). cac-only',
      '  -- field (VAT inputs over-broad for receipts, but one-shot).'],
    ARRAY['  -- edits re-arm nothing; bank_code rides in v_bank_changed.',
      '  -- Bank code rides in v_bank_changed.'],
    ARRAY['    OR v_synthetic_vat_changed', E'    OR v_synthetic_vat_changed\n    OR v_registration_changed'],
    ARRAY['  -- validation or alter the rendered snapshot; cac-only edits keep',
      '  -- validation or alter the rendered snapshot.'],
    ARRAY['  -- the lease. Marked rows stay for invalidation; sent and',
      '  -- Marked rows stay for invalidation; sent and'],
    ARRAY['  -- rendered-only subset. cac resets nothing; VAT inputs reset rowless',
      '  -- rendered-only subset. VAT inputs reset rowless'],
    ARRAY['  IF v_shared_changed OR v_business_address_changed THEN',
      $guard$  IF v_registration_changed THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL
      AND n.metadata->>'shared_invoice_claim_owner' = n.locked_by;
  END IF;
  IF v_shared_changed OR v_business_address_changed THEN$guard$],
    ARRAY[legacy_bank_guard,
      $guard$      AND CASE WHEN n.metadata->>'shared_invoice_claim_owner' = n.locked_by THEN
        o.total > COALESCE(o.amount_paid, 0)
        AND ((NULLIF(OLD.bank_account_number, '') IS NOT NULL
              AND private.resolved_merchant_bank_name(OLD.bank_name, OLD.bank_code) <> '')
          OR (NULLIF(NEW.bank_account_number, '') IS NOT NULL
              AND private.resolved_merchant_bank_name(NEW.bank_name, NEW.bank_code) <> ''))
      ELSE $guard$ || substr(legacy_bank_guard, length('      AND ') + 1) || ' END']
  ];
  edit text[];
BEGIN
  definition := pg_get_functiondef(legacy_dispatch);
  source := trim(leading E'\n' FROM previous_dispatch);
  IF strpos(definition, source) = 0 THEN
    RAISE EXCEPTION 'Expected legacy manual invoice dispatch guard is missing';
  END IF;
  definition := replace(definition, source, trim(leading E'\n' FROM next_dispatch));
  FOREACH edit SLICE 1 IN ARRAY dispatch_edits LOOP
    IF strpos(definition, edit[1]) = 0 THEN
      RAISE EXCEPTION 'Expected legacy dispatch fragment is missing: %', edit[1];
    END IF;
    definition := replace(definition, edit[1], edit[2]);
  END LOOP;
  EXECUTE replace(definition, legacy_dispatch_name || '(', shared_dispatch_name || '(');

  signature := substr(legacy_dispatch::text, strpos(legacy_dispatch::text, '('));
  EXECUTE 'REVOKE ALL ON FUNCTION ' || shared_dispatch_name || signature || ' FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION ' || shared_dispatch_name || signature || ' TO service_role';

  definition := pg_get_functiondef('private.rearm_manual_documents_after_merchant_update()'::regprocedure);
  FOREACH edit SLICE 1 IN ARRAY rearm_edits LOOP
    IF strpos(definition, edit[1]) = 0 THEN
      RAISE EXCEPTION 'Expected merchant rearm fragment is missing: %', edit[1];
    END IF;
    definition := replace(definition, edit[1], edit[2]);
  END LOOP;
  EXECUTE definition;
END;
$migration$;
