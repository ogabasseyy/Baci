-- Merchant-profile re-arm for manual-order documents, split from
-- 20260930160000_manual_order_document_notifications.sql (300-line rule).
-- Completing a merchant profile re-arms rows terminally skipped as
-- merchant_validation_failed, and snapshot-relevant merchant edits reset
-- in-flight dispatch markers. Applies after 60000 (outbox table shape);
-- 60300 enables the trigger post-deploy.
-- Safe predeploy: only a new function plus a trigger that ships DISABLED;
-- no live contract changes.

-- Resolved merchant address line, mirroring getMerchantAddressLine: the
-- registered parts joined exactly like the renderer (falsy parts dropped,
-- ', ' separator), falling back to the business address when empty.
-- Invoices print this; receipts always print the business address.
CREATE OR REPLACE FUNCTION private.resolved_merchant_address_line(
  p_registered_address jsonb, p_business_address text
)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT CASE
    WHEN coalesce(concat_ws(', ',
      NULLIF(p_registered_address->>'street', ''),
      NULLIF(p_registered_address->>'city', ''),
      NULLIF(p_registered_address->>'state', ''),
      NULLIF(p_registered_address->>'postal_code', ''),
      NULLIF(p_registered_address->>'country', '')), '') <> ''
    THEN concat_ws(', ',
      NULLIF(p_registered_address->>'street', ''),
      NULLIF(p_registered_address->>'city', ''),
      NULLIF(p_registered_address->>'state', ''),
      NULLIF(p_registered_address->>'postal_code', ''),
      NULLIF(p_registered_address->>'country', ''))
    ELSE p_business_address
  END;
$function$;
REVOKE ALL ON FUNCTION private.resolved_merchant_address_line(jsonb, text)
  FROM PUBLIC, anon, authenticated;

-- Effective rendered bank name, mirroring resolveMerchantBankName: a
-- valid stored name wins (trimmed, placeholder spellings rejected);
-- otherwise the code map fills it, else ''. The trigger and the
-- dispatch RPC compare this resolved value — never the raw columns.
CREATE OR REPLACE FUNCTION private.resolved_merchant_bank_name(
  p_bank_name text, p_bank_code text
)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_bank_name, ''), E' \t\n\r\f\v'))
      IN ('', 'unknown', 'unknown bank', 'n/a')
    THEN COALESCE(CASE p_bank_code
      WHEN '044' THEN 'Access Bank'
      WHEN '023' THEN 'Citibank Nigeria'
      WHEN '063' THEN 'Diamond Bank'
      WHEN '050' THEN 'Ecobank Nigeria'
      WHEN '070' THEN 'Fidelity Bank'
      WHEN '011' THEN 'First Bank of Nigeria'
      WHEN '214' THEN 'First City Monument Bank'
      WHEN '058' THEN 'Guaranty Trust Bank'
      WHEN '030' THEN 'Heritage Bank'
      WHEN '301' THEN 'Jaiz Bank'
      WHEN '082' THEN 'Keystone Bank'
      WHEN '526' THEN 'Parallex Bank'
      WHEN '076' THEN 'Polaris Bank'
      WHEN '101' THEN 'Providus Bank'
      WHEN '221' THEN 'Stanbic IBTC Bank'
      WHEN '068' THEN 'Standard Chartered Bank'
      WHEN '232' THEN 'Sterling Bank'
      WHEN '100' THEN 'Suntrust Bank'
      WHEN '032' THEN 'Union Bank of Nigeria'
      WHEN '033' THEN 'United Bank for Africa'
      WHEN '215' THEN 'Unity Bank'
      WHEN '035' THEN 'Wema Bank'
      WHEN '057' THEN 'Zenith Bank'
      WHEN '999992' THEN 'Opay'
      WHEN '50515' THEN 'Moniepoint'
      WHEN '999991' THEN 'PalmPay'
      WHEN '090110' THEN 'VFD Microfinance Bank'
      WHEN '090267' THEN 'Kuda Bank'
    END, '')
    ELSE btrim(p_bank_name, E' \t\n\r\f\v')
  END;
$function$;
REVOKE ALL ON FUNCTION private.resolved_merchant_bank_name(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.rearm_manual_documents_after_merchant_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bank_changed boolean;
  v_slug_changed boolean;
  v_slug_renders boolean;
  v_active_domain text;
  v_shared_changed boolean;
  v_business_address_changed boolean;
  v_resolved_address_changed boolean;
  v_validation_changed boolean;
  v_synthetic_vat_changed boolean;
  v_snapshot_changed boolean;
BEGIN
  -- Change flags first: both re-arm halves below gate on them.
  v_validation_changed :=
    OLD.slug IS DISTINCT FROM NEW.slug
    OR OLD.email IS DISTINCT FROM NEW.email
    OR OLD.vat_rate IS DISTINCT FROM NEW.vat_rate;
  -- Synthetic VAT inputs print via rowless-invoice synthesis.
  v_synthetic_vat_changed :=
    OLD.vat_registration_status IS DISTINCT FROM NEW.vat_registration_status
    OR OLD.vat_rate IS DISTINCT FROM NEW.vat_rate;
  -- The bank NAME compares resolved (stored name, else the code-map
  -- fallback): a code correction under a blank/placeholder name changes
  -- the emailed card, while a code-only edit under a valid name changes
  -- no pixel and must not go corrective.
  v_bank_changed :=
    OLD.bank_account_number IS DISTINCT FROM NEW.bank_account_number
    OR OLD.bank_account_name IS DISTINCT FROM NEW.bank_account_name
    OR private.resolved_merchant_bank_name(OLD.bank_name, OLD.bank_code)
      IS DISTINCT FROM
      private.resolved_merchant_bank_name(NEW.bank_name, NEW.bank_code);
  -- The slug renders via the host/From fallbacks or the ogabassey
  -- app-link gate: other renames under a safe domain reset nothing.
  v_slug_changed := OLD.slug IS DISTINCT FROM NEW.slug;
  SELECT d.domain INTO v_active_domain
  FROM public.domains AS d
  WHERE d.merchant_id = NEW.id AND d.is_primary = true
    AND d.status = 'active'
  ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id
  LIMIT 1;
  v_slug_renders :=
    NOT private.manual_document_domain_is_safe(v_active_domain)
    OR COALESCE(NULLIF(OLD.email_sender_name, ''), NULLIF(OLD.business_name, '')) IS NULL
    OR COALESCE(NULLIF(NEW.email_sender_name, ''), NULLIF(NEW.business_name, '')) IS NULL
    OR (OLD.slug = 'ogabassey') IS DISTINCT FROM (NEW.slug = 'ogabassey');
  v_shared_changed :=
    (v_slug_changed AND v_slug_renders)
    OR OLD.business_name IS DISTINCT FROM NEW.business_name
    OR OLD.legal_entity_name IS DISTINCT FROM NEW.legal_entity_name
    OR OLD.tax_identification_number IS DISTINCT FROM NEW.tax_identification_number
    OR OLD.support_email IS DISTINCT FROM NEW.support_email
    -- Contact phone renders resolved (support_phone, else phone).
    OR COALESCE(NULLIF(OLD.support_phone, ''), NULLIF(OLD.phone, ''))
      IS DISTINCT FROM COALESCE(NULLIF(NEW.support_phone, ''), NULLIF(NEW.phone, ''))
    OR OLD.email_sender_name IS DISTINCT FROM NEW.email_sender_name
    OR OLD.logo_url IS DISTINCT FROM NEW.logo_url
    OR (OLD.brand_colors->>'primary') IS DISTINCT FROM (NEW.brand_colors->>'primary');
  v_business_address_changed :=
    OLD.business_address IS DISTINCT FROM NEW.business_address;
  -- Invoices print the RESOLVED line (registered when nonempty, else the
  -- business address): a business_address edit under a nonempty registered
  -- address changes no invoice pixel and must not go corrective. Receipts
  -- always print the business address. Each kind resets independently so
  -- multi-field edits invalidate the union, never a subset.
  v_resolved_address_changed :=
    private.resolved_merchant_address_line(OLD.registered_address, OLD.business_address)
    IS DISTINCT FROM
    private.resolved_merchant_address_line(NEW.registered_address, NEW.business_address);
  -- Rendered snapshot inputs: validation repairs plus every printed
  -- field (VAT inputs over-broad for receipts, but one-shot). cac-only
  -- edits re-arm nothing; bank_code rides in v_bank_changed.
  v_snapshot_changed :=
    v_validation_changed
    OR v_synthetic_vat_changed
    OR v_shared_changed
    OR v_business_address_changed
    OR v_resolved_address_changed
    OR (v_bank_changed
      AND (OLD.bank_account_number IS NOT NULL
        OR NEW.bank_account_number IS NOT NULL));
  -- Profile completion re-arms validation-skipped rows; gates on
  -- validation inputs ONLY (slug, email, vat_rate). Other paths and
  -- terminal rows stay untouched; still-invalid profiles skip again.
  IF v_validation_changed THEN
    UPDATE public.order_notification_outbox AS n
    SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
      locked_by = NULL, locked_at = NULL, last_error = NULL,
      skip_reason = NULL, skipped_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'skipped' AND n.skip_reason = 'merchant_validation_failed'
      AND n.dispatch_started_at IS NULL;
  END IF;
  -- Undispatched processing rows re-arm when the edit can repair
  -- validation or alter the rendered snapshot; cac-only edits keep
  -- the lease. Marked rows stay for invalidation; sent and
  -- possibly-dispatched rows stay terminal.
  IF v_snapshot_changed THEN
    UPDATE public.order_notification_outbox AS n
    SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
      locked_by = NULL, locked_at = NULL, last_error = NULL,
      skip_reason = NULL, skipped_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'processing'
      AND n.dispatch_started_at IS NULL;
  END IF;
  -- Mid-dispatch edits reset the markers of the kinds that render
  -- them (union, never subset); the dispatch RPC compares the same
  -- rendered-only subset. cac resets nothing; VAT inputs reset rowless
  -- taxed invoices alone; the slug resets only where it renders.
  IF v_shared_changed OR v_business_address_changed THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type = 'manual_order_receipt'
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  END IF;
  IF v_shared_changed OR v_resolved_address_changed THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type = 'manual_order_invoice'
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  END IF;
  IF v_synthetic_vat_changed THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type = 'manual_order_invoice'
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.orders AS o
        WHERE o.id = n.order_id AND o.tax_amount > 0)
      AND NOT EXISTS (SELECT 1 FROM public.order_tax_subtotals AS ts
        WHERE ts.order_id = n.order_id);
  END IF;
  IF v_bank_changed
    AND (OLD.bank_account_number IS NOT NULL
      OR NEW.bank_account_number IS NOT NULL) THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    FROM public.orders AS o
    WHERE o.merchant_id = NEW.id
      AND n.order_id = o.id
      AND n.event_type = 'manual_order_invoice'
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL
      AND upper(trim(COALESCE(o.currency, 'NGN'))) = 'NGN'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_payment_accounts AS opa
        WHERE opa.order_id = o.id
          AND (opa.assignment_customer_email_source IS NULL
            OR opa.assignment_customer_email_source <> 'legacy_untrusted')
          AND (opa.expires_at IS NULL
            OR opa.expires_at > now() + interval '15 minutes')
          AND (COALESCE(opa.assigned_at, opa.created_at) IS NULL
            OR COALESCE(opa.assigned_at, opa.created_at) <= now()));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.rearm_manual_documents_after_merchant_update()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rearm_manual_documents_after_merchant_update
  AFTER UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION private.rearm_manual_documents_after_merchant_update();

-- Ship disabled like the 60000 triggers; 60300 enables post-deploy.
ALTER TABLE public.merchants DISABLE TRIGGER rearm_manual_documents_after_merchant_update;
CREATE OR REPLACE FUNCTION private.rearm_manual_documents_after_customer_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Restoring a soft-deleted customer (clearing deleted_at) or moving a
  -- live customer back under the order's merchant re-arms rows the
  -- worker terminally skipped as document_claim_unavailable: the claim
  -- gates on a live, order-scoped customers row, so without this a
  -- restored or rescoped document is permanently lost. Undispatched
  -- processing rows re-arm too, like the merchant and child paths: a
  -- restore racing the claim read would otherwise let the worker record
  -- a terminal skip from its stale decision. The join below matches
  -- only orders scoped to the new merchant, so a move away re-arms
  -- nothing. Other skip reasons keep their own re-arm paths; sent and
  -- possibly-dispatched rows stay terminal. The worker re-validates the
  -- claim on the next attempt, so a still-broken link simply skips again.
  IF (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
    OR (NEW.deleted_at IS NULL
      AND OLD.merchant_id IS DISTINCT FROM NEW.merchant_id) THEN
    UPDATE public.order_notification_outbox AS n
    SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
      locked_by = NULL, locked_at = NULL, last_error = NULL,
      skip_reason = NULL, skipped_at = NULL, updated_at = now()
    FROM public.orders AS o
    WHERE o.customer_id = NEW.id
      AND o.merchant_id = NEW.merchant_id
      AND n.order_id = o.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND ((n.status = 'skipped'
        AND n.skip_reason = 'document_claim_unavailable')
        OR n.status = 'processing')
      AND n.dispatch_started_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.rearm_manual_documents_after_customer_restore()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rearm_manual_documents_after_customer_restore
  AFTER UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION private.rearm_manual_documents_after_customer_restore();
-- Ship disabled like the merchant trigger; 60300 enables post-deploy.
ALTER TABLE public.customers DISABLE TRIGGER rearm_manual_documents_after_customer_restore;
