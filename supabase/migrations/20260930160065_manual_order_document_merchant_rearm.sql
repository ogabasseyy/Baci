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
BEGIN
  -- Completing a merchant profile (slug, VAT rate) re-arms rows the worker
  -- terminally skipped as merchant_validation_failed: only order and item
  -- changes invoke the order re-enqueue, so without this the corrected
  -- document is permanently lost. Other skip reasons keep their own re-arm
  -- paths; sent and possibly-dispatched rows stay terminal. The worker
  -- re-validates the merchant on the next attempt, so a still-invalid
  -- profile simply skips again until staff finish the correction.
  UPDATE public.order_notification_outbox AS n
  SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
    locked_by = NULL, locked_at = NULL, last_error = NULL,
    skip_reason = NULL, skipped_at = NULL, updated_at = now()
  WHERE n.merchant_id = NEW.id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND n.status = 'skipped'
    AND n.skip_reason = 'merchant_validation_failed'
    AND n.dispatch_started_at IS NULL;
  -- A snapshot-relevant merchant edit landing mid-dispatch resets every
  -- processing marker so the lease check aborts instead of recording a
  -- stale document as sent. Rendered branding (logo, colors) and the
  -- From display name invalidate alongside issuer/contact/payment fields.
  IF OLD.slug IS DISTINCT FROM NEW.slug
    OR OLD.business_name IS DISTINCT FROM NEW.business_name
    OR OLD.legal_entity_name IS DISTINCT FROM NEW.legal_entity_name
    OR OLD.business_address IS DISTINCT FROM NEW.business_address
    OR OLD.registered_address IS DISTINCT FROM NEW.registered_address
    OR OLD.cac_rc_number IS DISTINCT FROM NEW.cac_rc_number
    OR OLD.tax_identification_number IS DISTINCT FROM NEW.tax_identification_number
    OR OLD.vat_registration_status IS DISTINCT FROM NEW.vat_registration_status
    OR OLD.vat_rate IS DISTINCT FROM NEW.vat_rate
    OR OLD.support_email IS DISTINCT FROM NEW.support_email
    OR OLD.support_phone IS DISTINCT FROM NEW.support_phone
    OR OLD.phone IS DISTINCT FROM NEW.phone
    OR OLD.bank_code IS DISTINCT FROM NEW.bank_code
    OR OLD.bank_account_number IS DISTINCT FROM NEW.bank_account_number
    OR OLD.bank_name IS DISTINCT FROM NEW.bank_name
    OR OLD.bank_account_name IS DISTINCT FROM NEW.bank_account_name
    OR OLD.email_sender_name IS DISTINCT FROM NEW.email_sender_name
    OR OLD.logo_url IS DISTINCT FROM NEW.logo_url
    OR OLD.brand_colors IS DISTINCT FROM NEW.brand_colors
  THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    WHERE n.merchant_id = NEW.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
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
