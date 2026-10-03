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
-- Safe predeploy: new private functions plus triggers that ship DISABLED
-- (60300 enables them post-deploy); no live contract changes.
-- Serialization uses a per-order (or per-merchant) advisory lock taken
-- before the marker-qualified reset: it exists regardless of outbox
-- status, so a write that begins while the row is pending (or before
-- any row exists) still blocks the mark RPC, whose post-gate re-reads
-- then see the committed write. Locking the parent row instead would
-- reverse the mark RPC's order and deadlock, and gating on the outbox
-- row itself misses writes that start before the claim. Rows come
-- before advisory locks on every path (a trigger enters holding its
-- row lock; the mark locks rows first), and multi-key holders take
-- keys in ascending order, so no cycle forms.
CREATE OR REPLACE FUNCTION private.manual_document_gate_key(p_scope text, p_id uuid)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.hashtextextended('manual-order-gate:' || p_scope || ':' || p_id::text, 0);
$$;
REVOKE ALL ON FUNCTION private.manual_document_gate_key(text, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.lock_manual_document_gate(p_scope text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(private.manual_document_gate_key(p_scope, p_id));
END;
$$;
REVOKE ALL ON FUNCTION private.lock_manual_document_gate(text, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.lock_manual_document_gate_keys(p_first_key bigint, p_second_key bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Two-gate holders take ascending key order: opposite-direction movers
  -- would deadlock taking OLD/NEW order (a shared key locks once;
  -- collisions only over-serialize).
  IF p_first_key < p_second_key THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(p_first_key);
    PERFORM pg_catalog.pg_advisory_xact_lock(p_second_key);
  ELSIF p_first_key > p_second_key THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(p_second_key);
    PERFORM pg_catalog.pg_advisory_xact_lock(p_first_key);
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(p_first_key);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_manual_document_gate_keys(bigint, bigint)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.lock_manual_document_gate_pair(p_scope text, p_first_id uuid, p_second_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.lock_manual_document_gate_keys(
    private.manual_document_gate_key(p_scope, p_first_id),
    private.manual_document_gate_key(p_scope, p_second_id));
END;
$$;
REVOKE ALL ON FUNCTION private.lock_manual_document_gate_pair(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
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
CREATE OR REPLACE FUNCTION private.reset_manual_invoice_markers_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Receipts embed no payment instructions (the mark-started RPC compares
  -- no account fields for receipts), so account writes reset only invoice
  -- markers; in-flight receipt snapshots stay valid.
  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = NULL, updated_at = now()
  WHERE n.order_id = p_order_id
    AND n.event_type = 'manual_order_invoice'
    AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_invoice_markers_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.rearm_tax_invalid_manual_documents_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A tax correction re-arms rows the worker terminally skipped as
  -- tax_breakdown_invalid: without this the corrected invoice is never
  -- emailed. Invoice-scoped like the sender validation; the worker
  -- re-validates on the next attempt, so a still-invalid breakdown
  -- simply skips again until staff finish the correction.
  UPDATE public.order_notification_outbox AS n
  SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
    locked_by = NULL, locked_at = NULL, last_error = NULL,
    skip_reason = NULL, skipped_at = NULL, updated_at = now()
  WHERE n.order_id = p_order_id
    AND n.event_type = 'manual_order_invoice'
    AND n.status = 'skipped'
    AND n.skip_reason = 'tax_breakdown_invalid'
    AND n.dispatch_started_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.rearm_tax_invalid_manual_documents_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.rearm_payment_invalid_manual_documents_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A payment correction re-arms rows skipped as payment_history_invalid
  -- the same way: every kind renders the settled-payment table, so both
  -- events re-arm and the worker re-validates on the next attempt.
  UPDATE public.order_notification_outbox AS n
  SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
    locked_by = NULL, locked_at = NULL, last_error = NULL,
    skip_reason = NULL, skipped_at = NULL, updated_at = now()
  WHERE n.order_id = p_order_id
    AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    AND n.status = 'skipped'
    AND n.skip_reason = 'payment_history_invalid'
    AND n.dispatch_started_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.rearm_payment_invalid_manual_documents_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_tax_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Tax writes are rebuilds: any of them can change the snapshotted rows.
  -- Receipts render no subtotal breakdown (isInvoice only), so tax writes
  -- reset invoice markers alone; in-flight receipt snapshots stay valid.
  IF TG_OP = 'DELETE' THEN
    PERFORM private.lock_manual_document_gate('order', OLD.order_id);
    PERFORM private.reset_manual_invoice_markers_for_order(OLD.order_id);
    PERFORM private.rearm_tax_invalid_manual_documents_for_order(OLD.order_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM private.lock_manual_document_gate_pair('order', OLD.order_id, NEW.order_id);
    PERFORM private.reset_manual_invoice_markers_for_order(OLD.order_id);
    PERFORM private.rearm_tax_invalid_manual_documents_for_order(OLD.order_id);
    PERFORM private.reset_manual_invoice_markers_for_order(NEW.order_id);
    PERFORM private.rearm_tax_invalid_manual_documents_for_order(NEW.order_id);
    RETURN NEW;
  END IF;
  PERFORM private.lock_manual_document_gate('order', NEW.order_id);
  PERFORM private.reset_manual_invoice_markers_for_order(NEW.order_id);
  PERFORM private.rearm_tax_invalid_manual_documents_for_order(NEW.order_id);
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
  -- data is unchanged (webhook re-notifies) reset nothing either. Both
  -- early returns stay lock-free for the same reason.
  v_old_in_snapshot := TG_OP <> 'INSERT'
    AND OLD.transaction_type = 'payment'
    AND OLD.status IN ('completed', 'success');
  v_new_in_snapshot := TG_OP <> 'DELETE'
    AND NEW.transaction_type = 'payment'
    AND NEW.status IN ('completed', 'success');
  IF NOT v_old_in_snapshot AND NOT v_new_in_snapshot THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  -- Metadata compares on payment_method only: the PDF renders no other
  -- metadata key, so a webhook enrichment landing after the dispatch
  -- marker must not reset it into a corrective duplicate-send retry.
  IF v_old_in_snapshot AND v_new_in_snapshot
    AND OLD.amount IS NOT DISTINCT FROM NEW.amount
    AND OLD.description IS NOT DISTINCT FROM NEW.description
    AND (OLD.metadata->>'payment_method') IS NOT DISTINCT FROM (NEW.metadata->>'payment_method')
    AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
    AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id THEN
    RETURN NEW;
  END IF;
  -- Lock the entered order: an insert, an unsettled-to-settled flip, or a
  -- cross-order move would otherwise slip an uncommitted payment past the
  -- post-gate aggregates. The departed order needs no gate: its row was
  -- settled, so the mark's row locks already serialize against this write.
  IF v_new_in_snapshot THEN
    PERFORM private.lock_manual_document_gate('order', NEW.order_id);
  END IF;
  IF v_old_in_snapshot THEN
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    PERFORM private.rearm_payment_invalid_manual_documents_for_order(OLD.order_id);
  END IF;
  IF v_new_in_snapshot THEN
    PERFORM private.reset_manual_document_markers_for_order(NEW.order_id);
    PERFORM private.rearm_payment_invalid_manual_documents_for_order(NEW.order_id);
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
  -- Only writes that move the rendered instructions reset (NGN order,
  -- eligible, ranking first, either side). A non-selected edit leaves the
  -- rendered VA card untouched, so resetting would push an accepted
  -- invoice into a corrective duplicate. Receipts embed no accounts.
  IF TG_OP = 'DELETE' THEN
    IF private.manual_document_renders_payment_account(OLD.order_id, OLD) THEN
      PERFORM private.lock_manual_document_gate('order', OLD.order_id);
      PERFORM private.reset_manual_invoice_markers_for_order(OLD.order_id);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    IF private.manual_document_renders_payment_account(OLD.order_id, OLD)
      OR private.manual_document_renders_payment_account(NEW.order_id, NEW) THEN
      PERFORM private.lock_manual_document_gate_pair('order', OLD.order_id, NEW.order_id);
      IF private.manual_document_renders_payment_account(OLD.order_id, OLD) THEN
        PERFORM private.reset_manual_invoice_markers_for_order(OLD.order_id);
      END IF;
      IF private.manual_document_renders_payment_account(NEW.order_id, NEW) THEN
        PERFORM private.reset_manual_invoice_markers_for_order(NEW.order_id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF private.manual_document_renders_payment_account(NEW.order_id, NEW) THEN
      PERFORM private.lock_manual_document_gate('order', NEW.order_id);
      PERFORM private.reset_manual_invoice_markers_for_order(NEW.order_id);
    END IF;
    RETURN NEW;
  END IF;
  -- Same-order UPDATE: reset only when the rendered output moves; a
  -- no-op or non-rendered-column touch keeps the same card.
  IF private.manual_document_payment_account_output_changed(NEW.order_id, OLD, NEW) THEN
    PERFORM private.lock_manual_document_gate('order', NEW.order_id);
    PERFORM private.reset_manual_invoice_markers_for_order(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_markers_after_payment_account_write()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_manual_markers_after_payment_account_write
  AFTER INSERT OR UPDATE OR DELETE ON public.order_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION private.reset_manual_markers_after_payment_account_write();
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_customer_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A mid-dispatch soft-delete resets every processing marker for the
  -- customer's orders: the send aborts instead of emailing a link whose
  -- redemption immediately fails. Never re-arms (deletion suppresses);
  -- the dispatch RPC rechecks liveness so the retry terminally skips.
  IF TG_OP = 'UPDATE'
    AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.order_notification_outbox AS n
    SET dispatch_started_at = NULL, updated_at = now()
    FROM public.orders AS o
    WHERE o.customer_id = NEW.id
      AND n.order_id = o.id
      AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
      AND n.status = 'processing' AND n.dispatch_started_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reset_manual_markers_after_customer_delete()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_manual_markers_after_customer_delete
  AFTER UPDATE OF deleted_at ON public.customers
  FOR EACH ROW EXECUTE FUNCTION private.reset_manual_markers_after_customer_delete();
-- Ship disabled with the rest of the manual-document triggers; the
-- postdeploy enable step activates them together.
ALTER TABLE public.customers DISABLE TRIGGER reset_manual_markers_after_customer_delete;
ALTER TABLE public.order_tax_subtotals DISABLE TRIGGER reset_manual_markers_after_tax_write;
ALTER TABLE public.transactions DISABLE TRIGGER reset_manual_markers_after_transaction_write;
ALTER TABLE public.order_payment_accounts DISABLE TRIGGER reset_manual_markers_after_payment_account_write;

-- The claim-link domain trigger lives in the follow-up migration
-- 20260930160075 (300-line rule).
