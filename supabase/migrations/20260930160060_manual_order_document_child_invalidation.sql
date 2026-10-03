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
CREATE OR REPLACE FUNCTION private.reset_manual_markers_after_tax_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Tax writes are rebuilds: any of them can change the snapshotted rows.
  IF TG_OP = 'DELETE' THEN
    PERFORM private.lock_manual_document_gate('order', OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM private.lock_manual_document_gate_pair('order', OLD.order_id, NEW.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(NEW.order_id);
    RETURN NEW;
  END IF;
  PERFORM private.lock_manual_document_gate('order', NEW.order_id);
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
  -- Any account write can change the preferred pick, so every write locks
  -- and resets; assignments are rare admin operations.
  IF TG_OP = 'DELETE' THEN
    PERFORM private.lock_manual_document_gate('order', OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM private.lock_manual_document_gate_pair('order', OLD.order_id, NEW.order_id);
    PERFORM private.reset_manual_document_markers_for_order(OLD.order_id);
    PERFORM private.reset_manual_document_markers_for_order(NEW.order_id);
    RETURN NEW;
  END IF;
  PERFORM private.lock_manual_document_gate('order', NEW.order_id);
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
    PERFORM private.reset_manual_document_markers_for_merchant(NEW.merchant_id);
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.is_primary = true AND NEW.status = 'active' THEN
    PERFORM private.lock_manual_document_gate('merchant', NEW.merchant_id);
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
ALTER TABLE public.order_tax_subtotals DISABLE TRIGGER reset_manual_markers_after_tax_write;
ALTER TABLE public.transactions DISABLE TRIGGER reset_manual_markers_after_transaction_write;
ALTER TABLE public.order_payment_accounts DISABLE TRIGGER reset_manual_markers_after_payment_account_write;
ALTER TABLE public.domains DISABLE TRIGGER reset_manual_markers_after_domain_write;
