-- Invalidate in-flight manual dispatches when a snapshotted child row
-- changes. The dispatch RPC snapshots order items, tax subtotals, payment
-- history, the preferred virtual account, and the claim-link domain; items,
-- orders, and merchants already reset the marker through 60000, but without
-- these triggers a tax correction, payment insert, fresh account assignment,
-- or primary-domain change landing after the marker commits would send stale
-- and record it as clean. Row-level triggers keep OLD/NEW per row
-- (multi-event is legal without transition tables); the transaction gate
-- skips writes that cannot affect the settled-payment snapshot so hot
-- payment webhooks stay cheap.
CREATE OR REPLACE FUNCTION private.reset_manual_document_markers_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = NULL, updated_at = now()
  WHERE n.order_id = p_order_id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_document_markers_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
-- Pure-INSERT serialization: an uncommitted child insert is invisible to
-- the mark aggregates while its trigger's marker-qualified reset matches
-- nothing, so each trigger below locks the order (FOR NO KEY UPDATE,
-- mirroring the enqueue path) before resetting. The mark RPC holds the
-- same row FOR SHARE, so insert and mark serialize in commit order and
-- the aggregates always see the insert. Hot-path early returns stay
-- lock-free: writes outside the snapshot cannot affect the comparison.
CREATE OR REPLACE FUNCTION private.lock_manual_document_rows_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.orders AS o WHERE o.id = p_order_id FOR NO KEY UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_manual_document_rows_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.lock_manual_document_rows_for_merchant(p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.merchants AS m WHERE m.id = p_merchant_id FOR NO KEY UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_manual_document_rows_for_merchant(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_tax_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Tax writes are rebuilds: any of them can change the snapshotted rows.
  IF TG_OP = 'DELETE' THEN
    PERFORM private.lock_manual_document_rows_for_order(OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM private.lock_manual_document_rows_for_order(OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
  END IF;
  PERFORM private.lock_manual_document_rows_for_order(NEW.order_id);
  PERFORM private.reset_manual_document_markers_for_order(NEW.order_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_markers_after_tax_write()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_manual_markers_after_tax_write
  AFTER INSERT OR UPDATE OR DELETE ON public.order_tax_subtotals
  FOR EACH ROW EXECUTE FUNCTION private.reset_manual_markers_after_tax_write();
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_transaction_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_in_snapshot boolean;
  v_new_in_snapshot boolean;
BEGIN
  -- Only settled payments enter the snapshot: unsettled rows and
  -- non-payment types reset nothing, and in-snapshot rows whose compared
  -- data is unchanged (webhook re-notifies) reset nothing either.
  v_old_in_snapshot := TG_OP <> 'INSERT'
    AND OLD.transaction_type = 'payment'
    AND OLD.status IN ('completed', 'success');
  v_new_in_snapshot := TG_OP <> 'DELETE'
    AND NEW.transaction_type = 'payment'
    AND NEW.status IN ('completed', 'success');
  IF NOT v_old_in_snapshot AND NOT v_new_in_snapshot THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF v_old_in_snapshot AND v_new_in_snapshot
    AND OLD.amount IS NOT DISTINCT FROM NEW.amount
    AND OLD.description IS NOT DISTINCT FROM NEW.description
    AND OLD.metadata IS NOT DISTINCT FROM NEW.metadata
    AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
    AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id THEN
    RETURN NEW;
  END IF;
  -- Lock the entered order: the mark RPC locks only snapshotted rows, so
  -- an insert, an unsettled-to-settled flip, or a cross-order move would
  -- otherwise slip an uncommitted payment past the aggregates. Snapshotted
  -- updates and deletes already block on the RPC's row locks.
  IF v_new_in_snapshot THEN
    PERFORM private.lock_manual_document_rows_for_order(NEW.order_id);
  END IF;
  IF v_old_in_snapshot THEN
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
  END IF;
  IF v_new_in_snapshot THEN
    PERFORM private.reset_manual_document_markers_for_order(NEW.order_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_markers_after_transaction_write()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_manual_markers_after_transaction_write
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.reset_manual_markers_after_transaction_write();
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_payment_account_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Any account write can change the preferred pick, so every write
  -- locks and resets; assignments are rare admin operations. (The mark
  -- RPC locks only the picked row, so unlike tax, updates here lock too.)
  IF TG_OP = 'DELETE' THEN
    PERFORM private.lock_manual_document_rows_for_order(OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM private.lock_manual_document_rows_for_order(OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
  END IF;
  PERFORM private.lock_manual_document_rows_for_order(NEW.order_id);
  PERFORM private.reset_manual_document_markers_for_order(NEW.order_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_markers_after_payment_account_write()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_manual_markers_after_payment_account_write
  AFTER INSERT OR UPDATE OR DELETE ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION private.reset_manual_markers_after_payment_account_write();
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
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_domain_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Only the active primary feeds the claim URL: pending verifications
  -- and secondary hosts reset nothing, and a touch of the active primary
  -- that leaves the winning host unchanged (ssl_status refresh) resets
  -- nothing either.
  IF TG_OP = 'UPDATE'
    AND OLD.is_primary = true AND OLD.status = 'active'
    AND NEW.is_primary = true AND NEW.status = 'active'
    AND OLD.domain IS NOT DISTINCT FROM NEW.domain
    AND OLD.merchant_id IS NOT DISTINCT FROM NEW.merchant_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.is_primary = true AND NEW.status = 'active' THEN
    PERFORM private.lock_manual_document_rows_for_merchant(NEW.merchant_id);
    PERFORM private.reset_manual_document_markers_for_merchant(NEW.merchant_id);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.is_primary = true AND OLD.status = 'active' THEN
    PERFORM private.lock_manual_document_rows_for_merchant(OLD.merchant_id);
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
ALTER TABLE public.order_tax_subtotals DISABLE TRIGGER reset_manual_markers_after_tax_write;
ALTER TABLE public.transactions DISABLE TRIGGER reset_manual_markers_after_transaction_write;
ALTER TABLE public.order_payment_accounts DISABLE TRIGGER reset_manual_markers_after_payment_account_write;
ALTER TABLE public.domains DISABLE TRIGGER reset_manual_markers_after_domain_write;
