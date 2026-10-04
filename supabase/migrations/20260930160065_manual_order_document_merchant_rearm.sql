-- Merchant-profile re-arm for manual-order documents, split from
-- 20260930160000_manual_order_document_notifications.sql (300-line rule).
-- Completing a merchant profile re-arms rows terminally skipped as
-- merchant_validation_failed, and snapshot-relevant merchant edits reset
-- in-flight dispatch markers. Applies after 60000 (outbox table shape);
-- 60300 enables the trigger post-deploy.
-- Safe predeploy: only a new function plus a trigger that ships DISABLED;
-- no live contract changes.

CREATE OR REPLACE FUNCTION private.rearm_manual_documents_after_merchant_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bank_changed boolean;
BEGIN
  -- Completing a merchant profile (slug, VAT rate) re-arms rows the worker
  -- terminally skipped as merchant_validation_failed: only order and item
  -- changes invoke the order re-enqueue, so without this the corrected
  -- document is permanently lost. Undispatched processing rows re-arm too:
  -- a correction racing validation would otherwise let the worker record
  -- a terminal skip from its stale read. Other skip reasons keep their own
  -- re-arm paths; sent and possibly-dispatched rows stay terminal. The
  -- worker re-validates the merchant on the next attempt, so a still-invalid
  -- profile simply skips again until staff finish the correction.
  UPDATE public.order_notification_outbox AS n
  SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
    locked_by = NULL, locked_at = NULL, last_error = NULL,
    skip_reason = NULL, skipped_at = NULL, updated_at = now()
  WHERE n.merchant_id = NEW.id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND ((n.status = 'skipped' AND n.skip_reason = 'merchant_validation_failed')
      OR n.status = 'processing')
    AND n.dispatch_started_at IS NULL;
  -- A snapshot-relevant merchant edit landing mid-dispatch resets the
  -- markers of the kinds that render it, so the lease check aborts
  -- instead of recording a stale document as sent. Rendered branding
  -- (logo, primary color) and the From display name invalidate alongside
  -- issuer/contact fields. cac_rc_number, vat_registration_status, and
  -- vat_rate print nowhere (validation inputs only), so they reset
  -- nothing: an accepted, visually unchanged attachment must not go
  -- corrective. registered_address renders on invoices only (receipts
  -- print business_address), so it resets invoice markers alone.
  -- Bank fields reset invoice markers only, and only for NGN orders
  -- without a selected virtual account: receipts render no payment
  -- instructions, foreign-currency invoices strip all bank details, and
  -- a selected VA replaces the merchant-bank card. bank_code never
  -- prints (name/number/account name only) and the fallback card
  -- requires an account number to render at all, so code-only edits and
  -- numberless-merchant edits reset nothing either. The dispatch RPC
  -- compares the same rendered-only subset.
  v_bank_changed :=
    OLD.bank_account_number IS DISTINCT FROM NEW.bank_account_number
    OR OLD.bank_name IS DISTINCT FROM NEW.bank_name
    OR OLD.bank_account_name IS DISTINCT FROM NEW.bank_account_name;
  IF OLD.slug IS DISTINCT FROM NEW.slug
    OR OLD.business_name IS DISTINCT FROM NEW.business_name
    OR OLD.legal_entity_name IS DISTINCT FROM NEW.legal_entity_name
    OR OLD.business_address IS DISTINCT FROM NEW.business_address
    OR OLD.tax_identification_number IS DISTINCT FROM NEW.tax_identification_number
    OR OLD.support_email IS DISTINCT FROM NEW.support_email
    OR OLD.support_phone IS DISTINCT FROM NEW.support_phone
    OR OLD.phone IS DISTINCT FROM NEW.phone
    OR OLD.email_sender_name IS DISTINCT FROM NEW.email_sender_name
    OR OLD.logo_url IS DISTINCT FROM NEW.logo_url
    OR (OLD.brand_colors->>'primary') IS DISTINCT FROM (NEW.brand_colors->>'primary')
  THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  ELSIF OLD.registered_address IS DISTINCT FROM NEW.registered_address THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type = 'manual_order_invoice'
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  ELSIF v_bank_changed
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
