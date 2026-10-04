-- Claim-link domain invalidation for manual-order documents, split out of
-- 20260930160060 (300-line rule). A primary-domain change re-points the
-- receipt-claim URL, so in-flight manual dispatches reset their marker.
-- Uses 60060's advisory-lock helpers (runtime-resolved). Trigger ships
-- DISABLED; 20260930160300 enables it post-deploy.

CREATE OR REPLACE FUNCTION private.reset_manual_document_markers_for_merchant(p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = NULL, updated_at = now()
  WHERE n.merchant_id = p_merchant_id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_document_markers_for_merchant(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.rearm_manual_documents_after_domain_write(p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A new or changed active primary can rescue rows skipped as
  -- merchant_validation_failed (unsafe/null slug with no safe host):
  -- re-arm them plus undispatched processing rows that read the stale
  -- host. Callers run this BEFORE resetting markers so the undispatched
  -- test reads the live marker. Sent and possibly-dispatched rows stay
  -- terminal; the worker re-validates, so still-invalid rows skip again.
  UPDATE public.order_notification_outbox AS n
  SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
    locked_by = NULL, locked_at = NULL, last_error = NULL,
    skip_reason = NULL, skipped_at = NULL, updated_at = now()
  WHERE n.merchant_id = p_merchant_id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND ((n.status = 'skipped' AND n.skip_reason = 'merchant_validation_failed')
      OR n.status = 'processing')
    AND n.dispatch_started_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.rearm_manual_documents_after_domain_write(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_domain_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Only the active primary feeds the claim URL: pending verifications
  -- and secondary hosts reset nothing, and a touch of the active primary
  -- that leaves the winning host unchanged (ssl_status refresh) resets
  -- nothing either. The no-op gate stays lock-free for the same reason.
  IF TG_OP = 'UPDATE'
    AND OLD.is_primary = true AND OLD.status = 'active'
    AND NEW.is_primary = true AND NEW.status = 'active'
    AND OLD.domain IS NOT DISTINCT FROM NEW.domain
    AND OLD.merchant_id IS NOT DISTINCT FROM NEW.merchant_id THEN
    RETURN NEW;
  END IF;
  -- A cross-merchant primary move touches two merchant gates; take them
  -- in ascending order like the order moves so opposite movers agree.
  IF TG_OP = 'UPDATE' AND OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
    AND OLD.is_primary = true AND OLD.status = 'active'
    AND NEW.is_primary = true AND NEW.status = 'active' THEN
    PERFORM private.lock_manual_document_gate_pair('merchant', OLD.merchant_id, NEW.merchant_id);
    PERFORM private.reset_manual_document_markers_for_merchant(OLD.merchant_id);
    -- Only the gaining merchant can rescue validation-failed rows; the
    -- losing merchant falls back to its slug, which fixes nothing.
    PERFORM private.rearm_manual_documents_after_domain_write(NEW.merchant_id);
    PERFORM private.reset_manual_document_markers_for_merchant(NEW.merchant_id);
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.is_primary = true AND NEW.status = 'active' THEN
    PERFORM private.lock_manual_document_gate('merchant', NEW.merchant_id);
    PERFORM private.rearm_manual_documents_after_domain_write(NEW.merchant_id);
    PERFORM private.reset_manual_document_markers_for_merchant(NEW.merchant_id);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.is_primary = true AND OLD.status = 'active' THEN
    PERFORM private.lock_manual_document_gate('merchant', OLD.merchant_id);
    PERFORM private.reset_manual_document_markers_for_merchant(OLD.merchant_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_markers_after_domain_write()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_manual_markers_after_domain_write
  AFTER INSERT OR UPDATE OR DELETE ON public.domains
  FOR EACH ROW EXECUTE FUNCTION private.reset_manual_markers_after_domain_write();
-- Ship disabled with the rest of the manual-document triggers; the
-- postdeploy enable step activates them together.
ALTER TABLE public.domains DISABLE TRIGGER reset_manual_markers_after_domain_write;
