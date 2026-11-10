-- Financial order edits must not change a live or uncertain Oxygen obligation.
-- The shared advisory lock keeps ordinary item writers compatible while an
-- Oxygen workflow is absent. Oxygen admission takes the matching exclusive
-- lock without waiting, so a concurrent first workflow must retry instead of
-- racing a pre-workflow item edit.
CREATE FUNCTION oxygen_private.financial_edit_lock_key(p_order_id uuid)
RETURNS bigint LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT pg_catalog.hashtextextended('oxygen_financial_edit:' || p_order_id::text,0);
$$;
REVOKE ALL ON FUNCTION oxygen_private.financial_edit_lock_key(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- BEFORE INSERT runs before order_items RLS WITH CHECK. Keep a conflicting
-- order's existence or financing state private from untrusted callers.
CREATE FUNCTION oxygen_private.reject_financial_edit(p_order_id uuid,p_retry boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE merchant uuid; actor uuid := auth.uid();
BEGIN
 SELECT merchant_id INTO merchant FROM public.orders WHERE id=p_order_id;
 IF actor IS NULL OR NOT (
  EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant AND m.user_id=actor)
  OR coalesce(public.check_staff_permission(actor,merchant,'orders','edit'),false)
 ) THEN RAISE EXCEPTION 'order_edit_forbidden' USING ERRCODE='42501'; END IF;
 IF p_retry THEN RAISE EXCEPTION 'oxygen_order_edit_retry' USING ERRCODE='40001'; END IF;
 RAISE EXCEPTION 'oxygen_financial_edit_locked' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION oxygen_private.reject_financial_edit(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.assert_financial_edit_allowed(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE;
BEGIN
 IF p_order_id IS NULL THEN RETURN; END IF;
 IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(oxygen_private.financial_edit_lock_key(p_order_id)) THEN
  PERFORM oxygen_private.reject_financial_edit(p_order_id,true);
 END IF;
 -- Never wait for a workflow while holding an order/item row: existing
 -- cancellation and provider paths take these locks in different orders.
 BEGIN
  SELECT * INTO w FROM public.oxygen_workflows WHERE order_id=p_order_id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
  PERFORM oxygen_private.reject_financial_edit(p_order_id,true);
 END;
 IF NOT FOUND THEN RETURN; END IF;
 IF w.stage <> 'application_required'
  OR EXISTS (SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND (
    c.status IN ('queued','executing','indeterminate') OR
    (c.command->>'action'='start_application' AND c.status='succeeded') OR
    COALESCE(c.command->>'action','') NOT IN ('start_application','validate_customer','resend_customer_otp','refresh_eligibility','refresh_kyc','validate_nin','selfie_link')
  ))
  OR EXISTS (SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=w.id AND (s.state ? 'applicationReference' OR s.state ? 'bookingReference' OR s.state ? 'booking'))
  OR EXISTS (SELECT 1 FROM oxygen_private.provider_reference_history h WHERE h.workflow_id=w.id AND h.booking_reference IS NOT NULL)
  OR EXISTS (SELECT 1 FROM oxygen_private.saved_plans p WHERE p.workflow_id=w.id)
  OR EXISTS (SELECT 1 FROM oxygen_private.plan_selections p WHERE p.workflow_id=w.id)
  OR EXISTS (SELECT 1 FROM oxygen_private.payment_recovery p WHERE p.workflow_id=w.id)
  OR EXISTS (SELECT 1 FROM oxygen_private.activation_trials a WHERE a.workflow_id=w.id)
  OR EXISTS (SELECT 1 FROM oxygen_private.general_activations a WHERE a.workflow_id=w.id)
 THEN
  PERFORM oxygen_private.reject_financial_edit(p_order_id,false);
 END IF;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.assert_financial_edit_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.guard_order_financial_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(OLD.merchant_id,OLD.customer_id,OLD.payment_method,OLD.currency,OLD.subtotal,OLD.shipping_fee,OLD.gift_wrapping_fee,OLD.discount_amount,OLD.tax_basis,OLD.tax_amount,OLD.tax_exclusive_amount,OLD.tax_inclusive_amount,OLD.total)
  IS DISTINCT FROM ROW(NEW.merchant_id,NEW.customer_id,NEW.payment_method,NEW.currency,NEW.subtotal,NEW.shipping_fee,NEW.gift_wrapping_fee,NEW.discount_amount,NEW.tax_basis,NEW.tax_amount,NEW.tax_exclusive_amount,NEW.tax_inclusive_amount,NEW.total)
 THEN PERFORM oxygen_private.assert_financial_edit_allowed(OLD.id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_order_financial_edit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_guard_order_financial_edit BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_financial_edit();

CREATE FUNCTION oxygen_private.guard_order_item_financial_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_order uuid; new_order uuid;
BEGIN
 IF TG_TABLE_NAME='order_tax_subtotals' AND TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='order_items' AND TG_OP='UPDATE' AND NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['order_id','product_id','product_offer_id','offer_id','offer_line','offer_labels_snapshotted','quiz_award_id','quiz_award_amount','product_match_status','name','price','quantity','line_id','unit_code','line_extension_amount','vat_category_code','vat_rate','vat_amount','has_assurance','assurance_fee','variant_id','variant_name','condition','variant_attributes','item_description','sellers_item_id']) AS field(name)
  WHERE to_jsonb(OLD)->field.name IS DISTINCT FROM to_jsonb(NEW)->field.name
 ) THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN old_order:=OLD.order_id; END IF;
 IF TG_OP<>'DELETE' THEN new_order:=NEW.order_id; END IF;
 IF old_order IS NOT NULL AND new_order IS NOT NULL AND old_order<>new_order THEN
  PERFORM oxygen_private.assert_financial_edit_allowed(least(old_order,new_order));
  PERFORM oxygen_private.assert_financial_edit_allowed(greatest(old_order,new_order));
 ELSE
  PERFORM oxygen_private.assert_financial_edit_allowed(coalesce(old_order,new_order));
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_order_item_financial_edit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_guard_order_item_financial_edit BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_item_financial_edit();
CREATE TRIGGER oxygen_guard_order_tax_financial_edit BEFORE INSERT OR UPDATE OR DELETE ON public.order_tax_subtotals
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_item_financial_edit();

CREATE FUNCTION oxygen_private.guard_financial_edit_workflow_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT pg_catalog.pg_try_advisory_xact_lock(oxygen_private.financial_edit_lock_key(NEW.order_id)) THEN
  RAISE EXCEPTION 'oxygen_order_edit_retry' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_financial_edit_workflow_admission() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_guard_financial_edit_workflow_admission BEFORE INSERT ON public.oxygen_workflows
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_financial_edit_workflow_admission();

CREATE FUNCTION oxygen_private.guard_financial_edit_method_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.payment_method='oxygen' AND OLD.payment_method IS DISTINCT FROM 'oxygen'
  AND NOT pg_catalog.pg_try_advisory_xact_lock(oxygen_private.financial_edit_lock_key(OLD.id)) THEN
  RAISE EXCEPTION 'oxygen_order_edit_retry' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.guard_financial_edit_method_admission() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_guard_financial_edit_method_admission BEFORE UPDATE OF payment_method ON public.orders
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_financial_edit_method_admission();
