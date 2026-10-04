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
  v_shared_changed boolean;
  v_business_address_changed boolean;
  v_resolved_address_changed boolean;
  v_validation_changed boolean;
  v_snapshot_changed boolean;
BEGIN
  -- Change flags first: both re-arm halves below gate on them.
  v_validation_changed :=
    OLD.slug IS DISTINCT FROM NEW.slug
    OR OLD.email IS DISTINCT FROM NEW.email
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
  v_shared_changed :=
    OLD.slug IS DISTINCT FROM NEW.slug
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
  -- Rendered snapshot inputs: validation-repair fields plus every field
  -- the renderers print. cac_rc_number and vat_registration_status print
  -- nowhere, so edits confined to them re-arm nothing. (bank_code feeds
  -- the resolved bank name via the code-map fallback, so it rides along
  -- in v_bank_changed.) The bank half mirrors the invalidation below:
  -- the fallback card requires an account number to render at all.
  v_snapshot_changed :=
    v_validation_changed
    OR v_shared_changed
    OR v_business_address_changed
    OR v_resolved_address_changed
    OR (v_bank_changed
      AND (OLD.bank_account_number IS NOT NULL
        OR NEW.bank_account_number IS NOT NULL));
  -- Completing a merchant profile re-arms rows the worker terminally
  -- skipped as merchant_validation_failed: only order and item changes
  -- invoke the order re-enqueue, so without this the corrected document
  -- is permanently lost. The skipped-row re-arm gates on merchant-table
  -- validation inputs ONLY: slug feeds the claim-host gate (the custom
  -- domain itself lives in public.domains, covered by its own trigger),
  -- email is the schema's only other required field, and the VAT rate is
  -- its only other failable field (finite, non-negative) — every other
  -- merchants column is nullable or catch-guarded. Re-arming skipped
  -- rows on an unrelated profile save burns an attempt for a
  -- re-validation that cannot change. Other skip reasons keep their own
  -- re-arm paths; sent and possibly-dispatched rows stay terminal. The
  -- worker re-validates the merchant on the next attempt, so a
  -- still-invalid profile simply skips again until staff finish the
  -- correction.
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
  -- validation or alter the rendered snapshot: the worker may have
  -- snapshotted any rendered field already (branding, contacts,
  -- addresses), and a correction racing the snapshot read would
  -- otherwise let the worker record a terminal skip from its stale
  -- values. Edits confined to unrendered fields (cac_rc_number,
  -- vat_registration_status) keep the lease: repeated unrelated saves
  -- must not starve delivery. Marked rows stay for
  -- the invalidation half below; sent and possibly-dispatched rows
  -- stay terminal.
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
  -- A snapshot-relevant merchant edit landing mid-dispatch resets the
  -- markers of the kinds that render it, so the lease check aborts
  -- instead of recording a stale document as sent. Rendered branding
  -- (logo, primary color) and the From display name invalidate alongside
  -- issuer/contact fields. cac_rc_number, vat_registration_status, and
  -- vat_rate print nowhere (validation inputs only), so they reset
  -- nothing: an accepted, visually unchanged attachment must not go
  -- corrective. Addresses resolve per kind like the renderer: receipts
  -- print business_address, invoices print the registered line when it
  -- renders nonempty (else business_address) — a business_address edit
  -- under a nonempty registered address resets receipt markers alone.
  -- Bank fields reset invoice markers only, and only for NGN orders
  -- without a selected virtual account: receipts render no payment
  -- instructions, foreign-currency invoices strip all bank details, and
  -- a selected VA replaces the merchant-bank card. The name compares
  -- resolved (stored name, else the code-map fallback), so a code
  -- correction under a placeholder name resets while a code-only edit
  -- under a valid name does not; numberless-merchant edits reset
  -- nothing either. The dispatch RPC compares the same rendered-only
  -- subset. Each kind resets independently so multi-field edits
  -- invalidate the union, never a subset.
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
